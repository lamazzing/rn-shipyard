import { describe, it, expect, vi, afterEach } from "vitest";
import { exec } from "../../src/utils/shell.js";
import { collectSecrets, SECRET_ENV_VARS } from "../../src/utils/secrets.js";

const node = process.execPath;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((t: string) => (out.push(String(t)), true)) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((t: string) => (err.push(String(t)), true)) as never);
  return { out, err };
}
afterEach(() => vi.restoreAllMocks());

const shellwords = (s: string) => s.replace(/[^A-Za-z0-9_\-.,:+/@\n]/g, "\\$&");

const IOS_SECRETS = [
  "MATCH_PASSWORD",
  "MATCH_GIT_BASIC_AUTHORIZATION",
  "MATCH_GIT_PRIVATE_KEY",
  "FASTLANE_PASSWORD",
  "FASTLANE_SESSION",
  "FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD",
  "SUPPLY_JSON_KEY_DATA",
];

async function printIn(env: Record<string, string>, values: string[]) {
  const { out, err } = capture();
  const script = `for (const f of ${JSON.stringify(values)}) { console.log("o " + f + " end"); console.error("e " + f + " end"); }`;
  const r = await exec(node, ["-e", script], { stream: true, env });
  return { r, all: [r.stdout, r.stderr, ...out, ...err].join("|") };
}

describe("env secrets are redacted by default (no explicit redact)", () => {
  for (const name of IOS_SECRETS) {
    it(`${name}: raw and Shellwords-escaped`, async () => {
      const secret = `s3cr et!${name.length}$x'y`;
      const { r, all } = await printIn({ [name]: secret }, [secret, shellwords(secret)]);
      expect(all).not.toContain("s3cr");
      expect(r.stdout.split("\n")).toEqual(["o *** end", "o *** end"]);
      expect(r.stderr.split("\n")).toEqual(["e *** end", "e *** end"]);
    });
  }

  it("redacts every line of a multi-line .p8 but not PEM boundaries", async () => {
    const body1 = "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg";
    const body2 = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const p8 = `-----BEGIN PRIVATE KEY-----\n${body1}\n${body2}\n-----END PRIVATE KEY-----\n`;
    const { r, all } = await printIn({ APP_STORE_CONNECT_API_KEY_KEY: p8 }, [p8]);
    expect(all).not.toContain(body1);
    expect(all).not.toContain(body2);
    expect(r.stdout).toContain("-----BEGIN PRIVATE KEY-----");
    expect(r.stdout).toContain("-----END PRIVATE KEY-----");
  });

  it("also redacts the decoded basic-auth credentials", async () => {
    const token = Buffer.from("deploy-bot:ghp_tokenvalue123").toString("base64");
    const { all } = await printIn({ MATCH_GIT_BASIC_AUTHORIZATION: token }, [token, "ghp_tokenvalue123"]);
    expect(all).not.toContain("ghp_tokenvalue123");
    expect(all).not.toContain(token);
  });

  it("redacts the private_key inside SUPPLY_JSON_KEY_DATA when printed unescaped", async () => {
    const key = "-----BEGIN PRIVATE KEY-----\nLINEONEsecretsecret\nLINETWOsecretsecret\n-----END PRIVATE KEY-----\n";
    const json = JSON.stringify({ type: "service_account", private_key: key });
    const { all } = await printIn({ SUPPLY_JSON_KEY_DATA: json }, [key]);
    expect(all).not.toContain("LINEONEsecretsecret");
    expect(all).not.toContain("LINETWOsecretsecret");
  });

  it("uses the merged env, including process.env", async () => {
    vi.stubEnv("FASTLANE_SESSION", "from-process-env-secret");
    const { all } = await printIn({}, ["from-process-env-secret"]);
    vi.unstubAllEnvs();
    expect(all).not.toContain("from-process-env-secret");
  });

  it("explicit redact still works alongside env secrets", async () => {
    const { out } = capture();
    const r = await exec(node, ["-e", `console.log("a extra-one b envsecret-two")`], {
      stream: true,
      env: { MATCH_PASSWORD: "envsecret-two" },
      redact: ["extra-one"],
    });
    expect(r.stdout).toBe("a *** b ***");
    expect(out.join("")).toBe("a *** b ***\n");
  });
});

describe("collectSecrets", () => {
  it("ignores unset and empty values and unrelated vars", () => {
    expect(collectSecrets({ MATCH_PASSWORD: "", FASTLANE_PASSWORD: undefined, PATH: "/bin" })).toEqual([]);
  });
  it("covers every documented variable", () => {
    for (const n of ["MATCH_PASSWORD", "FASTLANE_SESSION", "APP_STORE_CONNECT_API_KEY_KEY", "ANDROID_KEY_PASSWORD"]) {
      expect(SECRET_ENV_VARS).toContain(n);
    }
  });
});

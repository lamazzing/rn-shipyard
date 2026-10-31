import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";

vi.mock("../../src/platforms/ios/signing.js", () => ({ setupMatch: vi.fn(async () => ({ success: true })) }));
vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn(), registerStdinReleaser: () => () => {} }));
const asked: string[] = [];
vi.mock("../../src/utils/prompt.js", () => ({
  createPrompter: vi.fn(() => ({
    ask: vi.fn(async (q: string, d?: string) => {
      asked.push(q);
      return d || "value";
    }),
    askSecret: vi.fn(async () => "never-asked"),
    close: vi.fn(),
  })),
}));

import { exec } from "../../src/utils/shell.js";
import { setupMatch } from "../../src/platforms/ios/signing.js";
import initCmd, { type InitOptions } from "../../src/commands/init.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

const PASSWORD = 'pw "with\\quotes" 9';
const URL = "git@github.com:me/certs.git";
const ENV = [
  "MATCH_PASSWORD", "MATCH_GIT_URL", "APPLE_TEAM_ID", "FASTLANE_USER",
  "APP_STORE_CONNECT_API_KEY_KEY_ID", "APP_STORE_CONNECT_API_KEY_ISSUER_ID",
  "APP_STORE_CONNECT_API_KEY_KEY", "APP_STORE_CONNECT_API_KEY_KEY_FILEPATH",
  "EXPO_ASC_API_KEY_PATH", "EXPO_ASC_KEY_ID", "EXPO_ASC_ISSUER_ID",
];
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

let dir: string;
let cwd: string;
let out: string[];
let saved: Record<string, string | undefined>;

async function run(extra: Partial<InitOptions> = {}): Promise<{ code: number; json: any }> {
  out = [];
  let code = 0;
  try {
    await initCmd({ platform: "ios", json: true, nonInteractive: true, ...extra });
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
    code = e.code;
  }
  let json: any;
  try {
    json = JSON.parse(out.join("\n"));
  } catch {
    json = undefined;
  }
  return { code, json };
}

const securityCalls = () => vi.mocked(exec).mock.calls.filter(([c]) => c === "security");

beforeEach(async () => {
  vi.clearAllMocks();
  asked.length = 0;
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-matchauth-")));
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.APPLE_TEAM_ID = "ABCDE12345";
  process.env.MATCH_GIT_URL = URL;
  process.env.MATCH_PASSWORD = PASSWORD;
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", ios: { bundleIdentifier: "com.x.app" } } })
  );
  process.chdir(dir);
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new ExitError(c ?? 0);
  }) as never);
  // security: the keychain lookup finds nothing (44), a store succeeds
  vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) =>
    cmd === "security" ? { exitCode: args[0] === "-i" ? 0 : 44, stdout: "", stderr: "" } : { exitCode: 1, stdout: "", stderr: "" }) as never);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (process.stdin as { isTTY?: boolean }).isTTY;
  delete (process.stdout as { isTTY?: boolean }).isTTY;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("init: Match signs in with the App Store Connect key", () => {
  it("hands the key variables to the match step, so no Apple ID is needed", async () => {
    process.env.APP_STORE_CONNECT_API_KEY_KEY_ID = "KEYID12345";
    process.env.APP_STORE_CONNECT_API_KEY_ISSUER_ID = "issuer-1";
    process.env.APP_STORE_CONNECT_API_KEY_KEY = P8;
    const { code, json } = await run();
    expect(code).toBe(0);
    const arg = vi.mocked(setupMatch).mock.calls[0][0];
    expect(arg.ascKeyEnv).toEqual({
      APP_STORE_CONNECT_API_KEY_KEY_ID: "KEYID12345",
      APP_STORE_CONNECT_API_KEY_ISSUER_ID: "issuer-1",
      APP_STORE_CONNECT_API_KEY_KEY: P8,
    });
    expect(json.setup.ios).toMatchObject({ status: "configured", matchAuth: "api-key" });
    expect(JSON.stringify(json)).not.toContain("BEGIN PRIVATE KEY");
  });

  it("uses the key of eas.json (ascApiKeyPath is made absolute, the file is not copied)", async () => {
    await mkdir(join(dir, "keys"));
    await writeFile(join(dir, "keys", "k.p8"), P8);
    await writeFile(
      join(dir, "eas.json"),
      JSON.stringify({
        build: { production: {} },
        submit: { production: { ios: { ascApiKeyPath: "./keys/k.p8", ascApiKeyId: "KEYID12345", ascApiKeyIssuerId: "issuer-1" } } },
      })
    );
    const { code, json } = await run();
    expect(code).toBe(0);
    expect(vi.mocked(setupMatch).mock.calls[0][0].ascKeyEnv).toEqual({
      APP_STORE_CONNECT_API_KEY_KEY_ID: "KEYID12345",
      APP_STORE_CONNECT_API_KEY_ISSUER_ID: "issuer-1",
      APP_STORE_CONNECT_API_KEY_KEY_FILEPATH: join(dir, "keys", "k.p8"),
    });
    expect(json.setup.ios.matchAuth).toBe("api-key");
  });

  it("without a key, an Apple ID (FASTLANE_USER) is used", async () => {
    process.env.FASTLANE_USER = "me@example.com";
    const { json } = await run();
    expect(vi.mocked(setupMatch).mock.calls[0][0].ascKeyEnv).toBeUndefined();
    expect(json.setup.ios).toMatchObject({ status: "configured", matchAuth: "apple-id" });
  });

  it("non-interactive with neither a key nor an Apple ID: fails before fastlane, fix names both options", async () => {
    const { code, json } = await run();
    expect(code).toBe(0); // the setup is written, the iOS step is reported as failed
    expect(setupMatch).not.toHaveBeenCalled();
    expect(json.setup.ios).toMatchObject({ status: "failed", errorCode: "MATCH_AUTH_MISSING" });
    expect(json.setup.ios.reason).toContain("App Store Connect API key");
    expect(json.setup.ios.nextStep).toMatch(/App Store Connect API key.*FASTLANE_USER/);
    expect(JSON.stringify(json)).not.toContain(PASSWORD);
  });
});

describe("init --save-match-password", () => {
  it("without MATCH_PASSWORD: exit 1, JSON error envelope, nothing written", async () => {
    delete process.env.MATCH_PASSWORD;
    const { code, json } = await run({ saveMatchPassword: true });
    expect(code).toBe(1);
    expect(json).toMatchObject({ success: false, error: { code: "MATCH_PASSWORD_MISSING" } });
    expect(json.error.fix).toContain("MATCH_PASSWORD=");
    expect(securityCalls()).toHaveLength(0);
    expect(setupMatch).not.toHaveBeenCalled();
  });

  it("with an empty MATCH_PASSWORD: the same error", async () => {
    process.env.MATCH_PASSWORD = "";
    const { code, json } = await run({ saveMatchPassword: true });
    expect(code).toBe(1);
    expect(json.error.code).toBe("MATCH_PASSWORD_MISSING");
  });

  it("non-interactive: stores the password through `security -i` on stdin, never in argv or output", async () => {
    process.env.FASTLANE_USER = "me@example.com";
    const { code, json } = await run({ saveMatchPassword: true });
    expect(code).toBe(0);
    const store = securityCalls().find(([, a]) => a[0] === "-i")!;
    expect(store[1]).toEqual(["-i"]);
    const opts = store[2] as { input: string; redact: string[] };
    expect(opts.input).toBe(
      `add-internet-password -a "" -s "match_${URL}" -U -w "pw \\"with\\\\quotes\\" 9"\n`
    );
    expect(opts.input.trimEnd().endsWith('"')).toBe(true);
    expect(opts.redact).toEqual([PASSWORD]);
    expect(JSON.stringify(vi.mocked(exec).mock.calls.map(([c, a]) => [c, a]))).not.toContain("with");
    expect(json.setup.ios).toMatchObject({ status: "configured", matchPassword: "env", matchPasswordKeychain: "saved" });
    expect(JSON.stringify(json)).not.toContain(PASSWORD);
    expect(out.join("\n")).not.toContain("quotes");
  });

  it("a failed save is an error (exit 1) that never contains the password", async () => {
    process.env.FASTLANE_USER = "me@example.com";
    vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) =>
      cmd === "security" ? { exitCode: args[0] === "-i" ? 36 : 44, stdout: "", stderr: "" } : { exitCode: 1, stdout: "", stderr: "" }) as never);
    const { code, json } = await run({ saveMatchPassword: true });
    expect(code).toBe(1);
    expect(json).toMatchObject({ success: false, error: { code: "KEYCHAIN_SAVE_FAILED" } });
    expect(JSON.stringify(json)).not.toContain("quotes");
    expect(setupMatch).not.toHaveBeenCalled();
  });

  it("without the flag nothing is written to the keychain", async () => {
    process.env.FASTLANE_USER = "me@example.com";
    await run();
    expect(securityCalls().find(([, a]) => a[0] === "-i")).toBeUndefined();
  });

  it("interactive: the flag answers the keychain offer with yes without asking", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const { code } = await run({ saveMatchPassword: true, json: false, nonInteractive: false });
    expect(code).toBe(0);
    expect(asked.some((q) => q.includes("keychain"))).toBe(false);
    expect(securityCalls().some(([, a]) => a[0] === "-i")).toBe(true);
    expect(vi.mocked(setupMatch).mock.calls[0][0]).toMatchObject({ interactive: true });
    expect(out.join("\n")).toContain("Match password saved in the macOS keychain");
  });
});

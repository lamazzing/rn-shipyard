import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";

vi.mock("../../src/platforms/android/keystore.js", () => ({ generateKeystore: vi.fn(async () => ({ created: true })) }));
vi.mock("../../src/platforms/ios/signing.js", () => ({ setupMatch: vi.fn(async () => ({ success: true })) }));
vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn(), registerStdinReleaser: () => () => {} }));

import { exec } from "../../src/utils/shell.js";
import { setupMatch } from "../../src/platforms/ios/signing.js";
import initCmd, { type InitOptions } from "../../src/commands/init.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

let dir: string;
let cwd: string;
let out: string[];
let saved: Record<string, string | undefined>;
const ENV = ["MATCH_PASSWORD", "MATCH_GIT_URL", "APPLE_TEAM_ID", "ANDROID_KEYSTORE_PASSWORD", "APP_STORE_CONNECT_API_KEY_KEY_ID"];

async function run(extra: Partial<InitOptions>): Promise<{ code: number; json: any }> {
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
const config = async () => JSON.parse(await readFile(join(dir, ".shipyard", "config.json"), "utf-8"));
const fastfile = () => readFile(join(dir, "fastlane", "Fastfile"), "utf-8");
const ANDROID = { platform: "android" as const, androidKeystore: "up.jks", androidCredentials: "up.json" };

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-merge-")));
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.APPLE_TEAM_ID = "ABCDE12345";
  process.env.MATCH_GIT_URL = "git@github.com:me/certs.git";
  process.env.MATCH_PASSWORD = "match-pw-123";
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", ios: { bundleIdentifier: "com.x.app" }, android: { package: "com.x.app" } } })
  );
  await writeFile(join(dir, "up.jks"), "x");
  await writeFile(join(dir, "up.json"), JSON.stringify({ keystorePassword: "pw-secret", keyAlias: "myalias", keyPassword: "pw-secret" }));
  process.chdir(dir);
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new ExitError(c ?? 0);
  }) as never);
  vi.mocked(exec).mockImplementation((async (cmd: string) =>
    cmd === "security" ? { exitCode: 44, stdout: "", stderr: "" } : { exitCode: 1, stdout: "", stderr: "" }) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("init merges into the existing config", () => {
  it("ios after android keeps the android block, its lanes, the version counter and the history", async () => {
    expect((await run(ANDROID)).code).toBe(0);
    const first = await config();
    await mkdir(join(dir, ".shipyard"), { recursive: true });
    await writeFile(join(dir, ".shipyard", "version-code.json"), JSON.stringify({ android: { lastUsed: 41 } }));
    await writeFile(join(dir, ".shipyard", "history.json"), JSON.stringify({ entries: [{ id: "keep" }] }));

    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(0);
    const after = await config();
    expect(after.platforms.android).toEqual(first.platforms.android);
    expect(after.platforms.android.keystoreAlias).toBe("myalias");
    expect(after.platforms.ios).toMatchObject({ bundleId: "com.x.app", teamId: "ABCDE12345" });
    expect(after.createdAt).toBe(first.createdAt);
    expect(json.setup.preserved).toEqual(["android"]);
    expect(json.files).toContain("fastlane/Matchfile");
    const ff = await fastfile();
    expect(ff).toContain("platform :ios do");
    expect(ff).toContain("platform :android do");
    expect(JSON.parse(await readFile(join(dir, ".shipyard", "version-code.json"), "utf-8"))).toEqual({ android: { lastUsed: 41 } });
    expect(JSON.parse(await readFile(join(dir, ".shipyard", "history.json"), "utf-8"))).toEqual({ entries: [{ id: "keep" }] });
  });

  it("android after ios keeps the ios block, the Matchfile and the ios lanes", async () => {
    expect((await run({ platform: "ios" })).code).toBe(0);
    const first = await config();
    const matchfile = await readFile(join(dir, "fastlane", "Matchfile"), "utf-8");

    const { code, json } = await run(ANDROID);
    expect(code).toBe(0);
    const after = await config();
    expect(after.platforms.ios).toEqual(first.platforms.ios);
    expect(after.platforms.android.keystoreAlias).toBe("myalias");
    expect(json.setup.preserved).toEqual(["ios"]);
    expect(json.setup.ios).toBeUndefined();
    expect(setupMatch).toHaveBeenCalledTimes(1); // the android run did not touch Match
    expect(await readFile(join(dir, "fastlane", "Matchfile"), "utf-8")).toBe(matchfile);
    const ff = await fastfile();
    expect(ff).toContain("platform :ios do");
    expect(ff).toContain("platform :android do");
    expect(await readFile(join(dir, "fastlane", "Appfile"), "utf-8")).toContain("com.x.app");
  });

  it("re-init of the same platform replaces that block, keeps the other, and needs no env after the first run", async () => {
    await run(ANDROID);
    await run({ platform: "ios" });
    for (const k of ["APPLE_TEAM_ID", "MATCH_GIT_URL"]) delete process.env[k];
    const { code } = await run({ platform: "ios" }); // team id and Match URL come from the existing config
    expect(code).toBe(0);
    const after = await config();
    expect(after.platforms.ios).toMatchObject({ teamId: "ABCDE12345", matchGitUrl: "git@github.com:me/certs.git" });
    expect(after.platforms.android.keystoreAlias).toBe("myalias");
  });

  it("android re-init without flags keeps the keystore, alias and credentials file (no new key, no password needed)", async () => {
    await run(ANDROID);
    const first = await config();
    const { code } = await run({ platform: "android" });
    expect(code).toBe(0);
    const after = await config();
    expect(after.platforms.android).toEqual(first.platforms.android);
    const { generateKeystore } = await import("../../src/platforms/android/keystore.js");
    expect(generateKeystore).not.toHaveBeenCalled();
  });

  it("an unreadable config is an error, never overwritten", async () => {
    await mkdir(join(dir, ".shipyard"), { recursive: true });
    await writeFile(join(dir, ".shipyard", "config.json"), "{ nope");
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(1);
    expect(json.error.code).toBe("INVALID_CONFIG");
    expect(await readFile(join(dir, ".shipyard", "config.json"), "utf-8")).toBe("{ nope");
  });
});

describe("init says what it did for iOS signing", () => {
  it("MATCH_PASSWORD missing: status skipped, with the next step, never 'configured'", async () => {
    delete process.env.MATCH_PASSWORD;
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(0);
    expect(setupMatch).not.toHaveBeenCalled();
    expect(json.setup.ios.status).toBe("skipped");
    expect(json.setup.ios.nextStep).toContain("MATCH_PASSWORD");
    expect(json.nextSteps[0]).toContain("rn-shipyard init --platform ios");
  });

  it("the text summary does not claim success when Match was skipped", async () => {
    delete process.env.MATCH_PASSWORD;
    out = [];
    try {
      await initCmd({ platform: "ios", json: false, nonInteractive: true });
    } catch {
      /* none expected */
    }
    const text = out.join("\n");
    expect(text).not.toContain("Match signing configured");
    expect(text).toContain("Match signing NOT set up");
    expect(text).not.toContain("Setup complete!");
  });

  it("Match failure: status failed", async () => {
    vi.mocked(setupMatch).mockResolvedValueOnce({ success: false, error: "bad decrypt" });
    const { json } = await run({ platform: "ios" });
    expect(json.setup.ios).toMatchObject({ status: "failed", reason: "bad decrypt" });
  });

  it("success: status configured, password source env", async () => {
    const { json } = await run({ platform: "ios" });
    expect(json.setup.ios).toMatchObject({ status: "configured", matchPassword: "env" });
    expect(JSON.stringify(json)).not.toContain("match-pw-123");
  });

  it("a passphrase found in the macOS keychain counts: match runs without MATCH_PASSWORD", async () => {
    delete process.env.MATCH_PASSWORD;
    vi.mocked(exec).mockImplementation((async (cmd: string) => ({ exitCode: cmd === "security" ? 0 : 1, stdout: "", stderr: "" })) as never);
    const { json } = await run({ platform: "ios" });
    expect(json.setup.ios).toMatchObject({ status: "configured", matchPassword: "keychain" });
    expect(vi.mocked(setupMatch).mock.calls[0][0].password).toBeUndefined();
    const lookup = vi.mocked(exec).mock.calls.find(([c]) => c === "security")!;
    expect(lookup[1]).toEqual(["find-internet-password", "-s", "match_git@github.com:me/certs.git"]);
  });
});

describe("init checks the App Store Connect API key", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const withKey = () => {
    process.env.APP_STORE_CONNECT_API_KEY_KEY_ID = "KEYID12345";
    process.env.APP_STORE_CONNECT_API_KEY_ISSUER_ID = "issuer-1";
    process.env.APP_STORE_CONNECT_API_KEY_KEY = P8;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["APP_STORE_CONNECT_API_KEY_KEY_ID", "APP_STORE_CONNECT_API_KEY_ISSUER_ID", "APP_STORE_CONNECT_API_KEY_KEY"]) delete process.env[k];
  });

  it("403: ASC_KEY_FORBIDDEN, exit 1, nothing written, Match not started", async () => {
    withKey();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(1);
    expect(json).toMatchObject({ success: false, error: { code: "ASC_KEY_FORBIDDEN" } });
    expect(json.error.fix).toContain("App Manager or Admin");
    expect(setupMatch).not.toHaveBeenCalled();
    await expect(readFile(join(dir, ".shipyard", "config.json"), "utf-8")).rejects.toThrow();
    expect(out.join("\n")).not.toContain("BEGIN PRIVATE KEY");
  });

  it("401: ASC_KEY_INVALID", async () => {
    withKey();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect((await run({ platform: "ios" })).json.error.code).toBe("ASC_KEY_INVALID");
  });

  it("app record missing: a warning, init continues", async () => {
    withKey();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(0);
    expect(json.setup.ios.ascKey).toBe("app-not-found");
    expect(json.warnings.join("\n")).toContain("app record not found for com.x.app");
  });

  it("network error: a warning, init continues", async () => {
    withKey();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(0);
    expect(json.setup.ios.ascKey).toBe("unreachable");
  });

  it("no key configured: no network call", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { json } = await run({ platform: "ios" });
    expect(f).not.toHaveBeenCalled();
    expect(json.setup.ios.ascKey).toBe("skipped");
  });
});

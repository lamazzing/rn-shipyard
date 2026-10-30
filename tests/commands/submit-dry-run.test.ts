import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/fastlane/runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/fastlane/runner.js")>(
    "../../src/fastlane/runner.js"
  );
  return { ...actual, runFastlane: vi.fn() };
});

vi.mock("../../src/utils/shell.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/shell.js")>("../../src/utils/shell.js");
  return { ...actual, exec: vi.fn() };
});

import { exec } from "../../src/utils/shell.js";
import { runFastlane } from "../../src/fastlane/runner.js";
import submitCmd from "../../src/commands/submit.js";

const CRED_ENV = [
  "SUPPLY_JSON_KEY",
  "FASTLANE_USER",
  "FASTLANE_PASSWORD",
  "FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD",
  "APP_STORE_CONNECT_API_KEY_KEY_ID",
  "APP_STORE_CONNECT_API_KEY_ISSUER_ID",
  "APP_STORE_CONNECT_API_KEY_KEY",
  "APP_STORE_CONNECT_API_KEY_KEY_FILEPATH",
  "FASTLANE_TEAM_ID",
  "PILOT_APPLE_ID",
];

let dir: string;
let cwd: string;
let out: string[];
let savedEnv: Record<string, string | undefined>;

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

async function run(opts: {
  platform: string;
  json?: boolean;
  dryRun?: boolean;
  nonInteractive?: boolean;
}): Promise<number> {
  try {
    await submitCmd({
      platform: opts.platform,
      json: opts.json ?? true,
      nonInteractive: opts.nonInteractive ?? true,
      dryRun: opts.dryRun ?? true,
    });
  } catch (e) {
    if (e instanceof ExitError) return e.code;
    throw e;
  }
  throw new Error("submit did not exit");
}

const json = () => JSON.parse(out.join("\n"));

async function setup(opts: {
  ipa?: boolean;
  aab?: boolean;
  appleId?: string;
  serviceAccount?: boolean;
  ios?: boolean;
  easAscKey?: boolean;
}) {
  await mkdir(join(dir, ".shipyard"), { recursive: true });
  await mkdir(join(dir, "output"), { recursive: true });
  await writeFile(
    join(dir, ".shipyard", "config.json"),
    JSON.stringify({
      version: "1.0.0",
      createdAt: "x",
      outputDir: "./output",
      platforms: {
        ...(opts.ios === false
          ? {}
          : { ios: { enabled: true, signingMethod: "match", matchGitUrl: "g", matchType: "appstore", teamId: "T", bundleId: "b" } }),
        android: { enabled: true, keystorePath: "k.jks", keystoreAlias: "release" },
      },
    })
  );
  const submit: Record<string, unknown> = {};
  if (opts.appleId) submit.ios = { appleId: opts.appleId };
  if (opts.easAscKey)
    submit.ios = { ascApiKeyPath: "./keys/AuthKey.p8", ascApiKeyId: "KEYID", ascApiKeyIssuerId: "ISSUER", ascAppId: "6740000000" };
  if (opts.serviceAccount) submit.android = { serviceAccountKeyPath: "sa.json" };
  await writeFile(join(dir, "eas.json"), JSON.stringify({ build: { production: {} }, submit: { production: submit } }));
  if (opts.serviceAccount) await writeFile(join(dir, "sa.json"), "{}");
  if (opts.ipa) await writeFile(join(dir, "output", "App-1.0.0-1.ipa"), "x");
  if (opts.aab) await writeFile(join(dir, "output", "App-1.0.0-1.aab"), "x");
  const history = {
    entries: [
      {
        id: "b1",
        timestamp: "2026-01-01T00:00:00Z",
        command: "build",
        profile: "production",
        platforms: {
          ios: { status: "success", version: "1.0.0", buildNumber: "1", artifactPath: "output/App-1.0.0-1.ipa", durationSeconds: 1, error: null },
          android: { status: "success", version: "1.0.0", versionCode: 1, artifactPath: "output/App-1.0.0-1.aab", durationSeconds: 1, error: null },
        },
      },
    ],
  };
  await writeFile(join(dir, ".shipyard", "history.json"), JSON.stringify(history, null, 2) + "\n");
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(exec).mockResolvedValue({ exitCode: 44, stdout: "", stderr: "" }); // no keychain entry
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-dry-")));
  process.chdir(dir);
  out = [];
  savedEnv = {};
  for (const k of CRED_ENV) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  for (const k of CRED_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("submit --dry-run", () => {
  it("iOS with valid inputs exits 0, prints the command, never uploads or writes history", async () => {
    await setup({ ipa: true, appleId: "me@example.com" });
    process.env.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD = "app-secret-pw";
    const before = await readFile(join(dir, ".shipyard", "history.json"), "utf-8");

    expect(await run({ platform: "ios" })).toBe(0);

    const res = json();
    expect(res.success).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.platforms.ios.status).toBe("ok");
    expect(res.platforms.ios.command).toEqual(["fastlane", "ios", "submit", `ipa_path:${join(dir, "output", "App-1.0.0-1.ipa")}`]);
    expect(out.join("\n")).not.toContain("app-secret-pw");
    expect(runFastlane).not.toHaveBeenCalled();
    expect(await readFile(join(dir, ".shipyard", "history.json"), "utf-8")).toBe(before);
  });

  it("iOS human output prints the command", async () => {
    await setup({ ipa: true, appleId: "me@example.com" });
    process.env.FASTLANE_PASSWORD = "pw";
    expect(await run({ platform: "ios", json: false })).toBe(0);
    expect(out.join("\n")).toContain("fastlane ios submit ipa_path:");
  });

  it("iOS with a missing .ipa reports a per-platform problem and exits 1", async () => {
    await setup({ ipa: false, appleId: "me@example.com" });
    process.env.FASTLANE_PASSWORD = "pw";
    expect(await run({ platform: "ios" })).toBe(1);
    const res = json();
    expect(res.success).toBe(false);
    expect(res.platforms.ios.status).toBe("error");
    expect(res.platforms.ios.problems[0]).toContain("Build artifact not found");
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("iOS with missing App Store Connect credentials reports a problem and exits 1", async () => {
    await setup({ ipa: true });
    expect(await run({ platform: "ios" })).toBe(1);
    const res = json();
    expect(res.platforms.ios.status).toBe("error");
    expect(res.platforms.ios.problems[0]).toContain("App Store Connect");
  });

  it("an App Store Connect API key satisfies the credentials check", async () => {
    await setup({ ipa: true });
    process.env.APP_STORE_CONNECT_API_KEY_KEY_ID = "K";
    process.env.APP_STORE_CONNECT_API_KEY_ISSUER_ID = "I";
    process.env.APP_STORE_CONNECT_API_KEY_KEY_FILEPATH = "/k.p8";
    expect(await run({ platform: "ios" })).toBe(0);
    expect(json().platforms.ios.status).toBe("ok");
  });

  it("an API key configured in eas.json (ascApiKeyPath/Id/IssuerId, like eas submit) satisfies it too", async () => {
    await setup({ ipa: true, easAscKey: true });
    expect(await run({ platform: "ios" })).toBe(0);
    expect(json().platforms.ios.status).toBe("ok");
    expect(process.env.APP_STORE_CONNECT_API_KEY_KEY_FILEPATH).toBe(join(dir, "keys", "AuthKey.p8"));
    expect(process.env.PILOT_APPLE_ID).toBe("6740000000");
  });

  it("--platform all lists both platforms, even when one has problems", async () => {
    await setup({ ipa: true, aab: true, serviceAccount: true });
    const code = await run({ platform: "all" });
    const res = json();
    expect(Object.keys(res.platforms).sort()).toEqual(["android", "ios"]);
    expect(res.platforms.android.status).toBe("ok");
    expect(res.platforms.ios.status).toBe("error");
    expect(code).toBe(1);
  });

  it("--platform all with both valid exits 0 and lists both commands", async () => {
    await setup({ ipa: true, aab: true, serviceAccount: true, appleId: "me@example.com" });
    process.env.FASTLANE_PASSWORD = "pw";
    expect(await run({ platform: "all" })).toBe(0);
    const res = json();
    expect(res.platforms.ios.command).not.toBeNull();
    expect(res.platforms.android.command).not.toBeNull();
  });

  it("--platform all reports a platform that is not enabled instead of dropping it", async () => {
    await setup({ aab: true, serviceAccount: true, ios: false });
    expect(await run({ platform: "all" })).toBe(0);
    const res = json();
    expect(res.platforms.ios.status).toBe("skipped");
    expect(res.platforms.android.status).toBe("ok");
  });

  it("Android dry run leaves history untouched", async () => {
    await setup({ aab: true, serviceAccount: true });
    const before = await readFile(join(dir, ".shipyard", "history.json"), "utf-8");
    expect(await run({ platform: "android" })).toBe(0);
    expect(await readFile(join(dir, ".shipyard", "history.json"), "utf-8")).toBe(before);
    expect(runFastlane).not.toHaveBeenCalled();
  });
});

describe("submit (real run) iOS credentials check", () => {
  it("fails fast with a MISSING_CONFIG error, exit 2, and never spawns fastlane", async () => {
    await setup({ ipa: true });
    expect(await run({ platform: "ios", dryRun: false })).toBe(2);
    const res = json();
    expect(res.success).toBe(false);
    expect(res.error.code).toBe("MISSING_CONFIG_IOS_CREDENTIALS");
    expect(res.error.message).toContain("No App Store Connect credentials");
    expect(res.error.fix).toBeTruthy();
    expect(res.platforms.ios.status).toBe("error");
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("with --non-interactive only (no --json) also fails fast", async () => {
    await setup({ ipa: true });
    expect(await run({ platform: "ios", dryRun: false, json: false, nonInteractive: true })).toBe(2);
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("interactive mode fails early too (fastlane cannot prompt on piped stdout), Android still runs", async () => {
    await setup({ ipa: true, aab: true, serviceAccount: true });
    vi.mocked(runFastlane).mockResolvedValue({ success: true, output: "", durationSeconds: 1 } as never);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    let code: number;
    try {
      code = await run({ platform: "all", dryRun: false, json: true, nonInteractive: false });
    } finally {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
    expect(code).toBe(2);
    const res = json();
    expect(res.error.code).toBe("MISSING_CONFIG_IOS_CREDENTIALS");
    expect(res.platforms.ios.status).toBe("error");
    expect(res.platforms.android.status).toBe("success");
    expect(runFastlane).toHaveBeenCalledTimes(1); // Android only
  });

  it("treats a keychain entry (fastlane-credentials add) as credentials", async () => {
    await setup({ ipa: true, appleId: "me@example.com" });
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    vi.mocked(runFastlane).mockResolvedValue({ success: true, output: "", durationSeconds: 1 } as never);
    expect(await run({ platform: "ios", dryRun: false })).toBe(0);
    expect(exec).toHaveBeenCalledWith("security", ["find-internet-password", "-s", "deliver.me@example.com"]);
    expect(runFastlane).toHaveBeenCalledTimes(1);
  });

  it("uses FASTLANE_USER for the keychain lookup, and a missing entry still fails", async () => {
    await setup({ ipa: true });
    process.env.FASTLANE_USER = "env@example.com";
    vi.mocked(exec).mockResolvedValue({ exitCode: 44, stdout: "", stderr: "" });
    expect(await run({ platform: "ios", dryRun: false })).toBe(2);
    expect(json().error.code).toBe("MISSING_CONFIG_IOS_CREDENTIALS");
    expect(exec).toHaveBeenCalledWith("security", ["find-internet-password", "-s", "deliver.env@example.com"]);
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("no Apple ID known: the keychain is not consulted", async () => {
    await setup({ ipa: true });
    expect(await run({ platform: "ios", dryRun: false })).toBe(2);
    expect(exec).not.toHaveBeenCalled();
  });

  it("runs fastlane when credentials are present", async () => {
    await setup({ ipa: true, appleId: "me@example.com" });
    process.env.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD = "pw";
    vi.mocked(runFastlane).mockResolvedValue({ success: true, output: "", durationSeconds: 1 } as never);
    expect(await run({ platform: "ios", dryRun: false })).toBe(0);
    expect(runFastlane).toHaveBeenCalledTimes(1);
  });
});

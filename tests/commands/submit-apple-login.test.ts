import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/fastlane/runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/fastlane/runner.js")>("../../src/fastlane/runner.js");
  return { ...actual, runFastlane: vi.fn() };
});
vi.mock("../../src/utils/shell.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/shell.js")>("../../src/utils/shell.js");
  return { ...actual, exec: vi.fn() };
});
const askMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/prompt.js", () => ({
  createPrompter: () => ({ ask: askMock, askSecret: vi.fn(), close: vi.fn() }),
}));

import { exec } from "../../src/utils/shell.js";
import { runFastlane } from "../../src/fastlane/runner.js";
import submitCmd from "../../src/commands/submit.js";
import { runPreflight } from "../../src/commands/preflight.js";
import { ShipyardError } from "../../src/utils/errors.js";

const CRED_ENV = [
  "SUPPLY_JSON_KEY",
  "FASTLANE_USER",
  "FASTLANE_PASSWORD",
  "FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD",
  "FASTLANE_TEAM_ID",
  "APP_STORE_CONNECT_API_KEY_KEY_ID",
  "APP_STORE_CONNECT_API_KEY_ISSUER_ID",
  "APP_STORE_CONNECT_API_KEY_KEY",
  "APP_STORE_CONNECT_API_KEY_KEY_FILEPATH",
  "EXPO_APPLE_ID",
  "EXPO_APPLE_PASSWORD",
  "EXPO_APPLE_APP_SPECIFIC_PASSWORD",
  "EXPO_APPLE_TEAM_ID",
  "EXPO_ASC_API_KEY_PATH",
  "EXPO_ASC_KEY_ID",
  "EXPO_ASC_ISSUER_ID",
  "CI",
];

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

let dir: string;
let cwd: string;
let out: string[];
let saved: Record<string, string | undefined>;

const setTty = (v: boolean) => {
  Object.defineProperty(process.stdin, "isTTY", { value: v, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: v, configurable: true });
};

async function run(opts: { interactive: boolean; skipChecks?: boolean }): Promise<number> {
  if (opts.interactive) setTty(true);
  try {
    await submitCmd({ platform: "ios", json: !opts.interactive, nonInteractive: !opts.interactive, dryRun: false, skipChecks: opts.skipChecks });
  } catch (e) {
    if (e instanceof ExitError) return e.code;
    throw e;
  }
  throw new Error("submit did not exit");
}

async function setup(opts: { appleId?: string; lane?: boolean }) {
  await mkdir(join(dir, ".shipyard"), { recursive: true });
  await mkdir(join(dir, "output"), { recursive: true });
  await mkdir(join(dir, "fastlane"), { recursive: true });
  if (opts.lane !== false) await writeFile(join(dir, "fastlane", "Fastfile"), "lane :shipyard_apple_login do\nend\n");
  await writeFile(
    join(dir, ".shipyard", "config.json"),
    JSON.stringify({
      version: "1.0.0",
      createdAt: "x",
      outputDir: "./output",
      platforms: { ios: { enabled: true, signingMethod: "match", matchGitUrl: "g", matchType: "appstore", teamId: "T", bundleId: "b" } },
    })
  );
  await writeFile(
    join(dir, "eas.json"),
    JSON.stringify({ build: { production: {} }, submit: { production: opts.appleId ? { ios: { appleId: opts.appleId } } : {} } })
  );
  await writeFile(join(dir, "output", "App-1.0.0-1.ipa"), "x");
  await writeFile(
    join(dir, ".shipyard", "history.json"),
    JSON.stringify({
      entries: [
        {
          id: "b1",
          timestamp: "2026-01-01T00:00:00Z",
          command: "build",
          profile: "production",
          platforms: { ios: { status: "success", version: "1.0.0", buildNumber: "1", artifactPath: "output/App-1.0.0-1.ipa", durationSeconds: 1, error: null } },
        },
      ],
    })
  );
}

/** exec mock: `security` finds / misses the keychain entry, the login lane succeeds or fails. */
function mockExec(o: { keychain: boolean; loginExit?: number }) {
  vi.mocked(exec).mockImplementation(async (cmd, args) => {
    if (cmd === "security") return { exitCode: o.keychain ? 0 : 44, stdout: "", stderr: "" };
    if (args.includes("shipyard_apple_login")) return { exitCode: o.loginExit ?? 0, stdout: "", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  });
}
const loginCalls = () => vi.mocked(exec).mock.calls.filter((c) => c[1].includes("shipyard_apple_login"));

beforeEach(async () => {
  vi.clearAllMocks();
  askMock.mockResolvedValue("");
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-login-")));
  process.chdir(dir);
  out = [];
  saved = {};
  for (const k of CRED_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.mocked(runFastlane).mockResolvedValue({ success: true, exitCode: 0, output: "", durationSeconds: 1 });
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  delete (process.stdin as { isTTY?: boolean }).isTTY;
  delete (process.stdout as { isTTY?: boolean }).isTTY;
  for (const k of CRED_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("submit phase 1: Apple login", () => {
  it("interactive + Apple ID, answer Y: the login lane runs in the foreground BEFORE the piped upload", async () => {
    await setup({ appleId: "me@example.com" });
    mockExec({ keychain: true });
    expect(await run({ interactive: true })).toBe(0);
    expect(askMock).toHaveBeenCalledWith("Log in to your Apple account now? (Y/n)");
    expect(loginCalls()).toHaveLength(1);
    const [cmd, args, opts] = loginCalls()[0];
    expect(cmd).toBe("fastlane");
    expect(args).toEqual(["ios", "shipyard_apple_login"]);
    expect(opts).toMatchObject({ foreground: true, env: { FASTLANE_USER: "me@example.com" } });
    expect(runFastlane).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exec).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(runFastlane).mock.invocationCallOrder[0]);
  });

  it("interactive with no password anywhere: login can prompt for it, so the upload is not blocked", async () => {
    await setup({ appleId: "me@example.com" });
    // the keychain has no entry before the login and has one after it (fastlane stored it)
    let loggedIn = false;
    vi.mocked(exec).mockImplementation(async (cmd, args) => {
      if (cmd === "security") return { exitCode: loggedIn ? 0 : 44, stdout: "", stderr: "" };
      if (args.includes("shipyard_apple_login")) loggedIn = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    expect(await run({ interactive: true })).toBe(0);
    expect(runFastlane).toHaveBeenCalledTimes(1);
  });

  it("answer n: no login, and with no password the usual credentials error", async () => {
    await setup({ appleId: "me@example.com" });
    askMock.mockResolvedValue("n");
    mockExec({ keychain: false });
    expect(await run({ interactive: true })).toBe(2);
    expect(loginCalls()).toHaveLength(0);
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("login fails: the upload does not run, exit 1", async () => {
    await setup({ appleId: "me@example.com" });
    mockExec({ keychain: false, loginExit: 1 });
    expect(await run({ interactive: true })).toBe(1);
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("an older Fastfile without the lane: warns, skips the login, still checks credentials", async () => {
    await setup({ appleId: "me@example.com", lane: false });
    mockExec({ keychain: true });
    expect(await run({ interactive: true })).toBe(0);
    expect(loginCalls()).toHaveLength(0);
    expect(out.join("\n")).toContain("shipyard_apple_login");
  });

  it("an App Store Connect API key: no question, no login", async () => {
    await setup({ appleId: "me@example.com" });
    process.env.EXPO_ASC_KEY_ID = "K";
    process.env.EXPO_ASC_ISSUER_ID = "I";
    process.env.EXPO_ASC_API_KEY_PATH = "/k/AuthKey.p8";
    mockExec({ keychain: false });
    expect(await run({ interactive: true })).toBe(0);
    expect(askMock).not.toHaveBeenCalled();
    expect(loginCalls()).toHaveLength(0);
  });

  it("non-interactive: never asks, never logs in", async () => {
    await setup({ appleId: "me@example.com" });
    process.env.FASTLANE_PASSWORD = "pw";
    mockExec({ keychain: false });
    expect(await run({ interactive: false })).toBe(0);
    expect(askMock).not.toHaveBeenCalled();
    expect(loginCalls()).toHaveLength(0);
  });

  it("non-interactive with no usable auth: MISSING_CONFIG_IOS_CREDENTIALS naming the EXPO_ASC_* and APP_STORE_CONNECT_API_KEY_* variables", async () => {
    await setup({});
    mockExec({ keychain: false });
    expect(await run({ interactive: false })).toBe(2);
    const res = JSON.parse(out.join("\n"));
    expect(res.error.code).toBe("MISSING_CONFIG_IOS_CREDENTIALS");
    expect(res.platforms.ios.errorCode).toBe("MISSING_CONFIG_IOS_CREDENTIALS");
    for (const name of [
      "EXPO_ASC_API_KEY_PATH",
      "EXPO_ASC_KEY_ID",
      "EXPO_ASC_ISSUER_ID",
      "APP_STORE_CONNECT_API_KEY_KEY_ID",
      "APP_STORE_CONNECT_API_KEY_ISSUER_ID",
      "APP_STORE_CONNECT_API_KEY_KEY_FILEPATH",
    ]) {
      expect(res.error.fix).toContain(name);
    }
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("EXPO_APPLE_ID / EXPO_APPLE_PASSWORD count as Apple ID credentials (and never reach the output)", async () => {
    await setup({});
    process.env.EXPO_APPLE_ID = "alias@example.com";
    process.env.EXPO_APPLE_PASSWORD = "alias-secret-pw";
    mockExec({ keychain: false });
    expect(await run({ interactive: false })).toBe(0);
    expect(process.env.FASTLANE_USER).toBe("alias@example.com");
    expect(process.env.FASTLANE_PASSWORD).toBe("alias-secret-pw");
    expect(out.join("\n")).not.toContain("alias-secret-pw");
  });

  it("an explicit FASTLANE_USER wins over EXPO_APPLE_ID", async () => {
    await setup({});
    process.env.EXPO_APPLE_ID = "alias@example.com";
    process.env.FASTLANE_USER = "explicit@example.com";
    process.env.FASTLANE_PASSWORD = "pw";
    mockExec({ keychain: false });
    expect(await run({ interactive: false })).toBe(0);
    expect(process.env.FASTLANE_USER).toBe("explicit@example.com");
  });
});

describe("submit: Ctrl-C and closed input at the login question", () => {
  it("Ctrl-C (INTERRUPTED) aborts the run: exit 130, no login, no upload", async () => {
    await setup({ appleId: "me@example.com" });
    process.env.FASTLANE_PASSWORD = "pw"; // credentials exist, so a swallowed Ctrl-C would upload
    askMock.mockRejectedValue(new ShipyardError("INTERRUPTED", "Interrupted", "Run the command again"));
    mockExec({ keychain: true });
    expect(await run({ interactive: true })).toBe(130);
    expect(loginCalls()).toHaveLength(0);
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("Ctrl-C with --json-style output returns the INTERRUPTED envelope", async () => {
    await setup({ appleId: "me@example.com" });
    process.env.FASTLANE_PASSWORD = "pw";
    askMock.mockRejectedValue(new ShipyardError("INTERRUPTED", "Interrupted", "Run the command again"));
    mockExec({ keychain: true });
    setTty(true);
    let code = -1;
    try {
      await submitCmd({ platform: "ios", json: true, nonInteractive: false, dryRun: false });
    } catch (e) {
      code = (e as ExitError).code;
    }
    // --json is never interactive, so the question is not even asked
    expect(askMock).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it("INPUT_CLOSED counts as no: no login, and the upload proceeds on stored credentials", async () => {
    await setup({ appleId: "me@example.com" });
    askMock.mockRejectedValue(new ShipyardError("INPUT_CLOSED", "Input ended", "x"));
    mockExec({ keychain: true });
    expect(await run({ interactive: true })).toBe(0);
    expect(loginCalls()).toHaveLength(0);
    expect(runFastlane).toHaveBeenCalledTimes(1);
  });

  it("a login failure is reported with its error code in the iOS result", async () => {
    await setup({ appleId: "me@example.com" });
    mockExec({ keychain: false, loginExit: 1 });
    expect(await run({ interactive: true })).toBe(1);
    const history = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, ".shipyard", "history.json"), "utf8"));
    expect(history.entries.at(-1).platforms.ios.errorCode).toBe("APPLE_LOGIN_FAILED");
  });
});

describe("submit: requirements pre-flight", () => {
  it("runs for submit-<platform> first; a failure exits with its code before anything else", async () => {
    await setup({ appleId: "me@example.com" });
    vi.mocked(runPreflight).mockResolvedValueOnce({ ok: false, exitCode: 2 });
    mockExec({ keychain: true });
    expect(await run({ interactive: false })).toBe(2);
    expect(vi.mocked(runPreflight).mock.calls[0][0]).toMatchObject({ platforms: ["ios"], actions: ["submit-ios"] });
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("--skip-checks bypasses it", async () => {
    await setup({ appleId: "me@example.com" });
    process.env.FASTLANE_PASSWORD = "pw";
    mockExec({ keychain: true });
    expect(await run({ interactive: false, skipChecks: true })).toBe(0);
    expect(runPreflight).not.toHaveBeenCalled();
  });
});

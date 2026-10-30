import { describe, it, expect, vi, beforeEach } from "vitest";
import { stat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

vi.mock("../../src/utils/shell.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/shell.js")>("../../src/utils/shell.js");
  return { ...actual, exec: vi.fn() };
});
import { exec } from "../../src/utils/shell.js";
import { prepareMatchRepo, safeUrl, MATCH_REPO_AUTH_FIX } from "../../src/platforms/ios/match-repo.js";
import { runCleanups, runSyncCleanups, clearCleanupsForTests } from "../../src/utils/cleanup.js";
import { ShipyardError } from "../../src/utils/errors.js";

const exists = (p: string) => stat(p).then(() => true, () => false);
/** Pretend git created the bare clone at the target path (args: clone --bare <url> <path>). */
const gitCreatesClone = (exitCode = 0, stderr = "", sshConfig = "") =>
  vi.mocked(exec).mockImplementation(async (_c, args) => {
    if (args[0] === "config") return { exitCode: sshConfig ? 0 : 1, stdout: sshConfig, stderr: "" };
    const target = args[args.length - 1];
    if (exitCode === 0) await mkdir(target, { recursive: true });
    return { exitCode, stdout: "", stderr };
  });

beforeEach(() => {
  vi.clearAllMocks();
  clearCleanupsForTests();
});

describe("prepareMatchRepo", () => {
  it("interactive: a bare all-branch clone in the foreground, no env tricks", async () => {
    gitCreatesClone();
    const clone = await prepareMatchRepo({ gitUrl: "git@github.com:me/certs.git", interactive: true, env: {} });
    expect(exec).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = vi.mocked(exec).mock.calls[0];
    expect(cmd).toBe("git");
    // the user's normal git behaviour: no -c overrides, no env overrides
    expect(args.slice(0, 4)).toEqual(["clone", "--bare", "--", "git@github.com:me/certs.git"]);
    expect(args).not.toContain("--depth");
    expect(opts).toEqual({ foreground: true });
    expect(args[4]).toBe(clone!.path);
    // private temp dir (0700)
    expect((await stat(dirname(clone!.path))).mode & 0o777).toBe(0o700);
    await clone!.dispose();
  });

  it("non-interactive: piped with GIT_TERMINAL_PROMPT=0 and ssh BatchMode, URL secrets redacted", async () => {
    gitCreatesClone();
    const clone = await prepareMatchRepo({
      gitUrl: "https://ghp_TOKEN123@github.com/me/certs.git",
      interactive: false,
      env: {},
    });
    const call = vi.mocked(exec).mock.calls.find((c) => c[1].includes("clone"))!;
    expect(call[1].slice(0, 9)).toEqual([
      "-c", "credential.interactive=never", "-c", "core.askPass=true",
      "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=60", "clone",
    ]);
    expect(call[1].slice(9, 12)).toEqual(["--bare", "--", "https://ghp_TOKEN123@github.com/me/certs.git"]);
    const opts = call[2]!;
    expect(opts.foreground).toBeUndefined();
    expect(opts.detached).toBe(true);
    expect(opts.env).toEqual({
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "true",
      SSH_ASKPASS: "true",
      SSH_ASKPASS_REQUIRE: "never",
      GCM_INTERACTIVE: "never",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15",
    });
    expect(opts.redact).toContain("ghp_TOKEN123");
    await clone!.dispose();
  });

  it("non-interactive: an existing GIT_SSH_COMMAND is preserved and BatchMode appended", async () => {
    gitCreatesClone();
    const clone = await prepareMatchRepo({
      gitUrl: "git@github.com:me/certs.git",
      interactive: false,
      env: { GIT_SSH_COMMAND: "ssh -i /my/key" },
    });
    const call = vi.mocked(exec).mock.calls.find((c) => c[1].includes("clone"))!;
    expect(call[2]!.env!.GIT_SSH_COMMAND).toBe("ssh -i /my/key -o BatchMode=yes -o ConnectTimeout=15");
    await clone!.dispose();
  });

  it("non-interactive: without GIT_SSH_COMMAND, git's core.sshCommand is the base", async () => {
    gitCreatesClone(0, "", "ssh -i /cfg/key");
    const clone = await prepareMatchRepo({ gitUrl: "git@h:r.git", interactive: false, env: {} });
    const call = vi.mocked(exec).mock.calls.find((c) => c[1].includes("clone"))!;
    expect(call[2]!.env!.GIT_SSH_COMMAND).toBe("ssh -i /cfg/key -o BatchMode=yes -o ConnectTimeout=15");
    await clone!.dispose();
  });

  it("safeUrl: userinfo -> ***, query and fragment removed, also for unparsable URLs", () => {
    expect(safeUrl("https://user:tok@github.com/me/certs.git?x=1#f")).toBe("https://***@github.com/me/certs.git");
    expect(safeUrl("https://tok@github.com/me/certs.git")).toBe("https://***@github.com/me/certs.git");
    expect(safeUrl("git@github.com:me/certs.git")).toBe("git@github.com:me/certs.git");
    const bad = safeUrl("https://user:tok@host:abc/x?token=s#h");
    expect(bad).toBe("https://***@host:abc/x");
    expect(bad).not.toMatch(/tok|user|token/);
  });

  it("failure: MATCH_REPO_AUTH_FAILED with the fix, no URL secret in the message, temp dir removed", async () => {
    let root = "";
    vi.mocked(exec).mockImplementation(async (_c, args) => {
      if (args[0] === "config") return { exitCode: 1, stdout: "", stderr: "" };
      root = dirname(args[args.length - 1]);
      return {
        exitCode: 128,
        stdout: "",
        stderr: "fatal: could not read Username for 'https://ghp_TOKEN123@github.com': terminal prompts disabled",
      };
    });
    const err = await prepareMatchRepo({
      gitUrl: "https://ghp_TOKEN123@github.com/me/certs.git",
      interactive: false,
      env: {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ShipyardError);
    expect(err.code).toBe("MATCH_REPO_AUTH_FAILED");
    expect(err.fix).toBe(MATCH_REPO_AUTH_FIX);
    expect(err.fix).toContain("ssh-add --apple-use-keychain");
    expect(err.fix).toContain("without --non-interactive");
    expect(err.message).not.toContain("ghp_TOKEN123");
    expect(err.message).toContain("https://***@github.com/me/certs.git");
    expect(await exists(root)).toBe(false);
  });

  it("failure in the foreground points at the output above", async () => {
    gitCreatesClone(128);
    const err = await prepareMatchRepo({ gitUrl: "git@h:r.git", interactive: true, env: {} }).catch((e) => e);
    expect(err.code).toBe("MATCH_REPO_AUTH_FAILED");
    expect(err.message).toContain("see the git output above");
  });

  it("the clone carries the env that redirects the REAL url to the local path (match keeps its own git_url)", async () => {
    gitCreatesClone();
    const clone = await prepareMatchRepo({ gitUrl: "git@github.com:me/certs.git", interactive: false, env: {} });
    expect(clone!.env).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${clone!.path}.insteadOf`,
      GIT_CONFIG_VALUE_0: "git@github.com:me/certs.git",
    });
    await clone!.dispose();
  });

  it("the redirect is appended after GIT_CONFIG_COUNT pairs from the environment", async () => {
    gitCreatesClone();
    const clone = await prepareMatchRepo({ gitUrl: "git@h:r.git", interactive: false, env: { GIT_CONFIG_COUNT: "1" } });
    expect(clone!.env.GIT_CONFIG_COUNT).toBe("2");
    expect(clone!.env.GIT_CONFIG_KEY_1).toBe(`url.${clone!.path}.insteadOf`);
    await clone!.dispose();
  });

  it("temp dir cleanup: dispose() after success removes it", async () => {
    gitCreatesClone();
    const clone = await prepareMatchRepo({ gitUrl: "git@h:r.git", interactive: false, env: {} });
    const root = dirname(clone!.path);
    expect(await exists(root)).toBe(true);
    await clone!.dispose();
    expect(await exists(root)).toBe(false);
    await clone!.dispose(); // idempotent
  });

  it("temp dir cleanup: the signal machinery (runCleanups) removes it", async () => {
    gitCreatesClone();
    const clone = await prepareMatchRepo({ gitUrl: "git@h:r.git", interactive: false, env: {} });
    const root = dirname(clone!.path);
    await runCleanups();
    expect(await exists(root)).toBe(false);
  });

  it("temp dir cleanup: the synchronous process-exit fallback removes it", async () => {
    gitCreatesClone();
    const clone = await prepareMatchRepo({ gitUrl: "git@h:r.git", interactive: false, env: {} });
    const root = dirname(clone!.path);
    runSyncCleanups();
    expect(await exists(root)).toBe(false);
  });

  it("rejects a URL starting with '-' (INVALID_MATCH_GIT_URL) before anything is created or run", async () => {
    const err = await prepareMatchRepo({ gitUrl: "--upload-pack=touch /tmp/pwned", interactive: false, env: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ShipyardError);
    expect(err.code).toBe("INVALID_MATCH_GIT_URL");
    expect(exec).not.toHaveBeenCalled();
  });

  it("skips (no clone) without a URL, or when fastlane's own non-prompting git auth is configured", async () => {
    expect(await prepareMatchRepo({ gitUrl: undefined, interactive: true, env: {} })).toBeUndefined();
    for (const name of ["MATCH_GIT_BASIC_AUTHORIZATION", "MATCH_GIT_BEARER_AUTHORIZATION", "MATCH_GIT_PRIVATE_KEY"]) {
      expect(await prepareMatchRepo({ gitUrl: "https://h/r.git", interactive: false, env: { [name]: "x" } })).toBeUndefined();
    }
    expect(exec).not.toHaveBeenCalled();
  });
});

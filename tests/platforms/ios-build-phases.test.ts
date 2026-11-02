import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/fastlane/runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/fastlane/runner.js")>("../../src/fastlane/runner.js");
  return { ...actual, runFastlane: vi.fn() };
});
vi.mock("../../src/platforms/ios/match-repo.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/platforms/ios/match-repo.js")>(
    "../../src/platforms/ios/match-repo.js"
  );
  return { ...actual, prepareMatchRepo: vi.fn() };
});
import { runFastlane } from "../../src/fastlane/runner.js";
import { prepareMatchRepo } from "../../src/platforms/ios/match-repo.js";
import { buildIos } from "../../src/platforms/ios/build.js";
import { ShipyardError } from "../../src/utils/errors.js";

let dir: string;
const config = {
  enabled: true,
  signingMethod: "match" as const,
  matchGitUrl: "https://tok@github.com/me/certs.git",
  matchType: "appstore" as const,
  teamId: "T",
  bundleId: "b",
};
const base = () => ({
  config,
  outputDir: "output",
  appName: "App",
  outputName: "App.ipa",
  projectDir: dir,
  json: true,
  interactive: true,
});

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), "shipyard-iosbuild-"));
  await mkdir(join(dir, "ios", "App.xcworkspace"), { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("buildIos: phase 1 (match repo) then phase 2 (piped lane)", () => {
  it("clones first (interactive flag threaded), runs the lane against the local clone, then disposes", async () => {
    const order: string[] = [];
    const dispose = vi.fn(async () => void order.push("dispose"));
    vi.mocked(prepareMatchRepo).mockImplementation(async () => {
      order.push("clone");
      return {
        path: "/tmp/shipyard-match-x/repo.git",
        env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url./tmp/shipyard-match-x/repo.git.insteadOf", GIT_CONFIG_VALUE_0: config.matchGitUrl },
        dispose,
      };
    });
    vi.mocked(runFastlane).mockImplementation((async () => {
      order.push("lane");
      return { success: true, exitCode: 0, output: "", durationSeconds: 1 };
    }) as never);

    const r = await buildIos(base());
    expect(r.status).toBe("success");
    expect(order).toEqual(["clone", "lane", "dispose"]);
    expect(prepareMatchRepo).toHaveBeenCalledWith({ gitUrl: config.matchGitUrl, interactive: true });
    const execOpts = vi.mocked(runFastlane).mock.calls[0][3];
    expect(execOpts.env).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "url./tmp/shipyard-match-x/repo.git.insteadOf",
      GIT_CONFIG_VALUE_0: config.matchGitUrl,
    });
    expect(execOpts).not.toHaveProperty("interactive");
    expect(execOpts.redact).toContain("tok");
  });

  it("disposes the clone when the lane fails", async () => {
    const dispose = vi.fn(async () => {});
    vi.mocked(prepareMatchRepo).mockResolvedValue({ path: "/p/repo.git", env: {}, dispose });
    vi.mocked(runFastlane).mockResolvedValue({ success: false, exitCode: 1, output: "boom", durationSeconds: 1 });
    const r = await buildIos({ ...base(), interactive: false });
    expect(r.status).toBe("error");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(prepareMatchRepo).toHaveBeenCalledWith({ gitUrl: config.matchGitUrl, interactive: false });
  });

  it("MATCH_REPO_AUTH_FAILED: the lane never runs and the error carries the code and fix", async () => {
    vi.mocked(prepareMatchRepo).mockRejectedValue(
      new ShipyardError("MATCH_REPO_AUTH_FAILED", "Could not clone the Match repository", "Load your key into ssh-agent")
    );
    const r = await buildIos({ ...base(), interactive: false });
    expect(r.status).toBe("error");
    expect(r.errorCode).toBe("MATCH_REPO_AUTH_FAILED");
    expect(r.error).toContain("Load your key into ssh-agent");
    expect(runFastlane).not.toHaveBeenCalled();
  });

  it("no clone (skipped): the lane gets no git redirect", async () => {
    vi.mocked(prepareMatchRepo).mockResolvedValue(undefined);
    vi.mocked(runFastlane).mockResolvedValue({ success: true, exitCode: 0, output: "", durationSeconds: 1 });
    await buildIos(base());
    expect(vi.mocked(runFastlane).mock.calls[0][3].env).toEqual({});
  });
});

describe("buildIos: gym log in the error", () => {
  const header = "::error ::xcodebuild: error: Could not resolve package dependencies:";
  const logBody = "xcodebuild: error: Could not resolve package dependencies:\n  package 'apple' is using Swift tools version 6.2.0 but the installed version is 6.1.0\n";
  const run = async () => {
    vi.mocked(prepareMatchRepo).mockResolvedValue(undefined);
    vi.mocked(runFastlane).mockResolvedValue({ success: false, exitCode: 1, output: `${header}\n${header}`, durationSeconds: 1 });
    return buildIos(base());
  };

  it("takes the reason from gym's log and shows the log path", async () => {
    const logs = join(dir, ".shipyard", "logs");
    await mkdir(logs, { recursive: true });
    await writeFile(join(logs, "App-App.log"), logBody);
    const r = await run();
    expect(r.error).toContain("Swift tools version 6.2.0");
    expect(r.error).toContain(`Full log: ${join(logs, "App-App.log")}`);
    expect(vi.mocked(runFastlane).mock.calls[0][2]).toMatchObject({ log_dir: logs });
  });

  it("falls back to the CLI error when there is no log", async () => {
    const r = await run();
    expect(r.error).toBe("xcodebuild: error: Could not resolve package dependencies:");
  });
});

describe("buildIos: gym log freshness and redaction", () => {
  const header = "xcodebuild: error: Could not resolve package dependencies:";
  const fail = (output: string) => {
    vi.mocked(prepareMatchRepo).mockResolvedValue(undefined);
    vi.mocked(runFastlane).mockResolvedValue({ success: false, exitCode: 1, output, durationSeconds: 1 });
    return buildIos(base());
  };
  const logsDir = () => join(dir, ".shipyard", "logs");

  it("ignores a log older than the build", async () => {
    await mkdir(logsDir(), { recursive: true });
    const f = join(logsDir(), "old.log");
    await writeFile(f, `${header}\n  old reason\n`);
    const old = new Date(Date.now() - 3_600_000);
    await utimes(f, old, old);
    const r = await fail(header);
    expect(r.error).toBe(header);
  });

  it("redacts secrets from the log text", async () => {
    await mkdir(logsDir(), { recursive: true });
    await writeFile(join(logsDir(), "a.log"), `${header}\n  token hunter2secret leaked\n`);
    vi.stubEnv("MATCH_PASSWORD", "hunter2secret");
    try {
      const r = await fail(header);
      expect(r.error).toContain("leaked");
      expect(r.error).not.toContain("hunter2secret");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps a rich CLI error and only adds the log path", async () => {
    await mkdir(logsDir(), { recursive: true });
    const f = join(logsDir(), "a.log");
    await writeFile(f, `${header}\n  other\n`);
    const r = await fail("error: Signing requires a development team");
    expect(r.error).toBe(`error: Signing requires a development team\nFull log: ${f}`);
  });
});

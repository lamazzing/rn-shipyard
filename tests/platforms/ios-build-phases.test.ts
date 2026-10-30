import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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

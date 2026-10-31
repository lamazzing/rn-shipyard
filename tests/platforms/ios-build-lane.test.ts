import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/fastlane/runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/fastlane/runner.js")>("../../src/fastlane/runner.js");
  return { ...actual, runFastlane: vi.fn() };
});
vi.mock("../../src/platforms/ios/match-repo.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/platforms/ios/match-repo.js")>("../../src/platforms/ios/match-repo.js");
  return { ...actual, prepareMatchRepo: vi.fn(async () => undefined) };
});
import { runFastlane } from "../../src/fastlane/runner.js";
import { buildIos } from "../../src/platforms/ios/build.js";
import { iosLaneTouchedFiles } from "../../src/platforms/ios/signing-files.js";
import { getLastUsedIosBuildNumber } from "../../src/core/build-number.js";
import { clearCleanupsForTests } from "../../src/utils/cleanup.js";

let dir: string;
const config = {
  enabled: true,
  signingMethod: "match" as const,
  matchGitUrl: "git@h:o/r.git",
  matchType: "appstore",
  teamId: "T",
  bundleId: "com.x.app",
};
const PBX = 'x\nINFOPLIST_FILE = "My App/Info.plist";\nINFOPLIST_FILE = "$(SRCROOT)/My App/Info.plist";\nINFOPLIST_FILE = "$(TARGET)/x";\n';
const PLIST = "<plist>CFBundleVersion 1</plist>";
const base = () => ({
  config,
  outputDir: "output",
  appName: "App",
  outputName: "App-1.0.0-__BUILD_NUMBER__.ipa",
  projectDir: dir,
  buildNumber: 3,
  json: true,
  interactive: false,
});

beforeEach(async () => {
  vi.clearAllMocks();
  clearCleanupsForTests();
  dir = await mkdtemp(join(tmpdir(), "shipyard-ioslane-"));
  await mkdir(join(dir, "ios", "MyApp.xcworkspace"), { recursive: true });
  await mkdir(join(dir, "ios", "MyApp.xcodeproj"), { recursive: true });
  await mkdir(join(dir, "ios", "Pods.xcodeproj"), { recursive: true });
  await mkdir(join(dir, "ios", "My App"), { recursive: true });
  await writeFile(join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"), PBX);
  await writeFile(join(dir, "ios", "My App", "Info.plist"), PLIST);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const ok = (output: string) => ({ success: true, exitCode: 0, output, durationSeconds: 1 });

describe("iOS build lane: build number", () => {
  it("passes the candidate to the lane, names the artifact after the number the lane chose and records it", async () => {
    vi.mocked(runFastlane).mockResolvedValue(ok("[10:00:00]: SHIPYARD_BUILD_NUMBER=8\n[10:00:00]: SHIPYARD_TESTFLIGHT_LATEST=7\n"));
    const r = await buildIos(base());
    expect(r).toMatchObject({ status: "success", buildNumber: 8, testflightLatest: 7, artifactPath: "output/App-1.0.0-8.ipa" });
    const [, , options] = vi.mocked(runFastlane).mock.calls[0];
    expect(options).toMatchObject({ build_number: "3", output_name: "App-1.0.0-__BUILD_NUMBER__.ipa", build_number_override: undefined });
    expect(await getLastUsedIosBuildNumber(dir)).toBe(8);
  });

  it("without TestFlight (no marker value) uses the local number; override is flagged to the lane", async () => {
    vi.mocked(runFastlane).mockResolvedValue(ok("SHIPYARD_BUILD_NUMBER=3\nSHIPYARD_TESTFLIGHT_LATEST=none\n"));
    const r = await buildIos({ ...base(), buildNumberOverride: true });
    expect(r).toMatchObject({ status: "success", buildNumber: 3, artifactPath: "output/App-1.0.0-3.ipa" });
    expect(r.testflightLatest).toBeUndefined();
    expect(vi.mocked(runFastlane).mock.calls[0][2]).toMatchObject({ build_number_override: "true" });
  });

  it("never advances the counter after a failed build, and reports the real error", async () => {
    vi.mocked(runFastlane).mockResolvedValue({
      success: false,
      exitCode: 1,
      output: "[!] Get started using a Gemfile for fastlane\nSHIPYARD_BUILD_NUMBER=4\n▸ error: Signing for \"A\" requires a development team.\n[!] Error building the application",
      durationSeconds: 1,
    });
    const r = await buildIos(base());
    expect(r.status).toBe("error");
    expect(r.error).toContain("requires a development team");
    expect(r.error).not.toContain("Gemfile");
    expect(r.buildNumber).toBe(4);
    expect(await getLastUsedIosBuildNumber(dir)).toBe(0);
  });

  it("refuses a Fastfile from an older rn-shipyard (no signing step) instead of failing in Xcode", async () => {
    await mkdir(join(dir, "fastlane"), { recursive: true });
    await writeFile(join(dir, "fastlane", "Fastfile"), "lane :build do\n gym\nend\n");
    const r = await buildIos(base());
    expect(r).toMatchObject({ status: "error", errorCode: "FASTFILE_OUTDATED" });
    expect(runFastlane).not.toHaveBeenCalled();
    await writeFile(join(dir, "fastlane", "Fastfile"), "# shipyard-ios-signing\n");
    vi.mocked(runFastlane).mockResolvedValue(ok(""));
    expect((await buildIos(base())).status).toBe("success");
  });
});

describe("iOS build lane: a tracked ios/ is put back", () => {
  it("finds the project file and the Info.plist the lane edits (never Pods)", async () => {
    expect((await iosLaneTouchedFiles(dir, "ios/MyApp.xcworkspace")).sort()).toEqual([
      "ios/My App/Info.plist",
      "ios/MyApp.xcodeproj/project.pbxproj",
    ]);
  });

  const mutate = async () => {
    await writeFile(join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"), PBX + "DEVELOPMENT_TEAM = T;\n");
    await writeFile(join(dir, "ios", "My App", "Info.plist"), "<plist>CFBundleVersion 9</plist>");
  };

  it("restores project.pbxproj and Info.plist byte for byte after success", async () => {
    vi.mocked(runFastlane).mockImplementation((async () => {
      await mutate();
      return ok("SHIPYARD_BUILD_NUMBER=3\n");
    }) as never);
    const info = vi.fn();
    const r = await buildIos({ ...base(), restoreNativeFiles: true, info });
    expect(r.status).toBe("success");
    expect(await readFile(join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"), "utf-8")).toBe(PBX);
    expect(await readFile(join(dir, "ios", "My App", "Info.plist"), "utf-8")).toBe(PLIST);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Restored"));
  });

  it("restores after a failed build too", async () => {
    vi.mocked(runFastlane).mockImplementation((async () => {
      await mutate();
      return { success: false, exitCode: 1, output: "error: boom", durationSeconds: 1 };
    }) as never);
    const r = await buildIos({ ...base(), restoreNativeFiles: true });
    expect(r.status).toBe("error");
    expect(await readFile(join(dir, "ios", "My App", "Info.plist"), "utf-8")).toBe(PLIST);
  });

  it("restores when the runner throws", async () => {
    vi.mocked(runFastlane).mockImplementation((async () => {
      await mutate();
      throw new Error("spawn exploded");
    }) as never);
    await expect(buildIos({ ...base(), restoreNativeFiles: true })).rejects.toThrow("spawn exploded");
    expect(await readFile(join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"), "utf-8")).toBe(PBX);
  });

  it("leaves a generated (untracked/ignored) ios/ alone: nothing is snapshotted or restored", async () => {
    vi.mocked(runFastlane).mockImplementation((async () => {
      await mutate();
      return ok("SHIPYARD_BUILD_NUMBER=3\n");
    }) as never);
    await buildIos({ ...base(), restoreNativeFiles: false });
    expect(await readFile(join(dir, "ios", "My App", "Info.plist"), "utf-8")).toContain("CFBundleVersion 9");
  });
});

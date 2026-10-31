import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));
vi.mock("../../src/platforms/android/build.js", () => ({ buildAndroid: vi.fn() }));
vi.mock("../../src/platforms/ios/build.js", () => ({ buildIos: vi.fn() }));
vi.mock("../../src/commands/submit.js", () => ({
  default: vi.fn(),
  runSubmit: vi.fn(),
  appleLoginPhase: vi.fn(),
  readIosAppleId: vi.fn(async () => "me@example.com"),
}));

import { exec } from "../../src/utils/shell.js";
import { buildIos } from "../../src/platforms/ios/build.js";
import { writeConfig } from "../../src/core/config.js";
import { recordIosBuildNumber } from "../../src/core/build-number.js";
import { readHistory } from "../../src/core/history.js";
import buildCmd from "../../src/commands/build.js";

let dir: string;
let cwd: string;
let logged: string[];
const ASC = ["EXPO_ASC_KEY_ID", "EXPO_ASC_ISSUER_ID", "EXPO_ASC_API_KEY_PATH", "APP_STORE_CONNECT_API_KEY_KEY_ID", "APP_STORE_CONNECT_API_KEY_ISSUER_ID", "APP_STORE_CONNECT_API_KEY_KEY_FILEPATH"];
const saved: Record<string, string | undefined> = {};
const opts = { platform: "ios", profile: "production", submit: false, skipVersionCheck: true, skipChecks: true, json: true, nonInteractive: true };
const printed = () => logged.map((l) => JSON.parse(l));

beforeEach(async () => {
  vi.clearAllMocks();
  for (const k of ASC) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "shipyard-iosnum-"));
  await writeFile(join(dir, "package.json"), "{}\n");
  await writeFile(join(dir, "app.json"), JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", ios: { buildNumber: "1" } } }));
  await writeConfig(dir, {
    version: "1.0.0",
    createdAt: "x",
    platforms: { ios: { enabled: true, signingMethod: "match", matchGitUrl: "git@h:o/r.git", matchType: "appstore", teamId: "T", bundleId: "com.x.app" } },
    outputDir: "./output",
  });
  await mkdir(join(dir, "ios"), { recursive: true });
  process.chdir(dir);
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  logged = [];
  vi.spyOn(console, "log").mockImplementation(((m: string) => void logged.push(m)) as never);
  // ios/ is tracked in git -> no prebuild, restoreNativeFiles on
  vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) => {
    if (cmd === "git") {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true", stderr: "" };
      return { exitCode: 0, stdout: "ios/App.xcodeproj/project.pbxproj", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }) as never);
  vi.mocked(buildIos).mockImplementation((async (o: { buildNumber: number }) => ({
    status: "success",
    artifactPath: `output/a-${o.buildNumber + 5}.ipa`,
    durationSeconds: 1,
    buildNumber: o.buildNumber + 5, // the lane raised it above TestFlight's latest
    testflightLatest: o.buildNumber + 4,
  })) as never);
});

afterEach(() => {
  process.chdir(cwd);
  for (const k of ASC) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("build: iOS build number", () => {
  it("passes the local candidate, restores nothing for generated ios/, and records the number the lane used in history and JSON", async () => {
    await recordIosBuildNumber(dir, 2);
    await buildCmd(opts);
    expect(buildIos).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildIos).mock.calls[0][0]).toMatchObject({
      buildNumber: 3,
      buildNumberOverride: false,
      restoreNativeFiles: true, // tracked ios/
      outputName: "App-1.0.0-__BUILD_NUMBER__.ipa",
    });
    const out = printed()[0];
    expect(out.platforms.ios).toMatchObject({ status: "success", buildNumber: "8" });
    expect((await readHistory(dir)).entries[0].platforms.ios?.buildNumber).toBe("8");
  });

  it("--build-number overrides and is flagged; a reused number is a clean JSON error before any build", async () => {
    await buildCmd({ ...opts, buildNumber: "20" });
    expect(vi.mocked(buildIos).mock.calls[0][0]).toMatchObject({ buildNumber: 20, buildNumberOverride: true });

    await recordIosBuildNumber(dir, 20);
    vi.mocked(buildIos).mockClear();
    logged.length = 0;
    await buildCmd({ ...opts, buildNumber: "20" });
    expect(buildIos).not.toHaveBeenCalled();
    expect(printed()[0]).toMatchObject({ success: false, error: { code: "BUILD_NUMBER_REUSED" } });
  });

  it("rejects a non-numeric --build-number", async () => {
    await buildCmd({ ...opts, buildNumber: "abc" });
    expect(printed()[0]).toMatchObject({ success: false, error: { code: "INVALID_BUILD_NUMBER" } });
  });

  it("without App Store Connect credentials, prints one hint line; with EXPO_ASC_* it does not", async () => {
    const info = vi.spyOn(console, "log");
    await buildCmd({ ...opts, json: false });
    const text = () => info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(text()).toContain("continue from the latest TestFlight build number");

    info.mockClear();
    process.env.EXPO_ASC_KEY_ID = "K";
    process.env.EXPO_ASC_ISSUER_ID = "I";
    process.env.EXPO_ASC_API_KEY_PATH = "/k.p8";
    await buildCmd({ ...opts, json: false });
    expect(text()).not.toContain("continue from the latest TestFlight build number");
    expect(text()).toContain("latest TestFlight build");
    // the alias reached the name fastlane reads
    expect(process.env.APP_STORE_CONNECT_API_KEY_KEY_ID).toBe("K");
  });

  it("surfaces the real error from a failed build (history and JSON carry the same text)", async () => {
    vi.mocked(buildIos).mockResolvedValue({ status: "error", durationSeconds: 1, error: 'error: Signing for "App" requires a development team.', buildNumber: 3 });
    await buildCmd(opts);
    expect(printed()[0].platforms.ios).toMatchObject({ status: "error", error: expect.stringContaining("requires a development team"), buildNumber: "3" });
    expect((await readHistory(dir)).entries[0].platforms.ios?.error).toContain("requires a development team");
    expect(await readFile(join(dir, ".shipyard", "history.json"), "utf-8")).toContain("requires a development team");
  });
});

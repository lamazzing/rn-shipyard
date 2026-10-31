import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { generateFastfile } from "../../src/fastlane/generator.js";
import type { ShipyardConfig } from "../../src/core/config.js";

/**
 * REAL fastlane: fastlane runs a lane body with cwd = fastlane/, so project-relative paths must be
 * expanded against the project root. Needs `fastlane` and an Expo app with a prebuilt ios/
 * (SHIPYARD_RESOLVE_APP, default: the scratch demo app). Skipped otherwise.
 */
const APP =
  process.env.SHIPYARD_RESOLVE_APP ??
  "/private/tmp/claude-501/-Users-luca-DevProjects-rn-shipyard/7c51a137-d27e-4255-b8ec-b6784bc0ffa3/scratchpad/resolve-app";
const hasFastlane = spawnSync("fastlane", ["--version"], { encoding: "utf-8" }).status === 0;
const hasIos = existsSync(join(APP, "ios")) && existsSync(join(APP, "ios", "Podfile"));
const run = hasFastlane && hasIos;

const config: ShipyardConfig = {
  version: "1.0.0",
  createdAt: "x",
  outputDir: "./output",
  platforms: { ios: { enabled: true, signingMethod: "match", matchGitUrl: "g", matchType: "appstore", teamId: "ABCDE12345", bundleId: "com.example.myexpoapp" } },
};

describe.skipIf(!run)("shipyard_ios_resolve with real fastlane", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "shipyard-resolve-"));
    await cp(join(APP, "ios"), join(dir, "ios"), { recursive: true });
    await generateFastfile(dir, config, "App");
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const lane = (workspace: string) =>
    spawnSync("fastlane", ["ios", "shipyard_ios_resolve", `workspace:${workspace}`, "scheme:myexpoapp", "bundle_id:com.example.myexpoapp"], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, FASTLANE_SKIP_UPDATE_CHECK: "1", FASTLANE_HIDE_TIMESTAMP: "1", FASTLANE_OPT_OUT_USAGE: "1", CI: "1" },
    });

  it("finds the xcodeproj, the app target and the Info.plist from a project-relative workspace", async () => {
    // the workspace only exists after pod install; the lane needs the .xcodeproj next to it
    const rel = "ios/" + (await readdir(join(dir, "ios"))).find((e) => e.endsWith(".xcodeproj"))!.replace(/\.xcodeproj$/, ".xcworkspace");
    const r = lane(rel);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toMatch(/SHIPYARD_RESOLVED project=.*ios\/myexpoapp\.xcodeproj target=myexpoapp plist=.*ios\/myexpoapp\/Info\.plist/);
  }, 120_000);

  it("also works with an absolute workspace (what rn-shipyard build passes)", () => {
    const r = lane(join(dir, "ios", "myexpoapp.xcworkspace"));
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain(`project=${join(dir, "ios", "myexpoapp.xcodeproj")}`);
  }, 120_000);

  it("reports a missing project instead of guessing", () => {
    const r = lane("ios/Nope.xcworkspace");
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("Xcode project not found next to the workspace");
  }, 120_000);
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { generateFastfile } from "../../src/fastlane/generator.js";
import type { ShipyardConfig } from "../../src/core/config.js";

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), "shipyard-ffios-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

const config = (iosOverrides = {}): ShipyardConfig => ({
  version: "1.0.0",
  createdAt: "x",
  outputDir: "./output",
  platforms: {
    ios: { enabled: true, signingMethod: "match", matchGitUrl: "git@h:o/r.git", matchType: "appstore", teamId: "ABC123DEF4", bundleId: "com.example.app", ...iosOverrides },
    android: { enabled: true, keystorePath: "k.jks", keystoreAlias: "release" },
  },
});

async function fastfile(c = config()): Promise<string> {
  await generateFastfile(dir, c, "My App");
  return readFile(join(dir, "fastlane", "Fastfile"), "utf-8");
}

describe("iOS build lane", () => {
  it("is valid Ruby", async () => {
    await fastfile();
    const r = spawnSync("ruby", ["-c", join(dir, "fastlane", "Fastfile")], { encoding: "utf-8" });
    expect(r.stdout + r.stderr).toContain("Syntax OK");
    expect(r.status).toBe(0);
  });

  it("applies manual signing to the app target only, after match and before gym", async () => {
    const f = await fastfile();
    const match = f.indexOf("match(");
    const signing = f.indexOf("update_code_signing_settings(");
    const gym = f.indexOf("gym(");
    expect(match).toBeGreaterThan(-1);
    expect(signing).toBeGreaterThan(match);
    expect(gym).toBeGreaterThan(signing);
    expect(f).toContain("use_automatic_signing: false");
    expect(f).toContain("targets: [app_target.name]");
    expect(f).toContain('team_id = "ABC123DEF4"');
    expect(f).toContain('bundle_id = "com.example.app"');
    expect(f).toContain("bundle_identifier: bundle_id");
    expect(f).toContain("profile_name: profile_name");
    expect(f).toContain("code_sign_identity: code_sign_identity");
    // only the app project (never Pods), found next to the workspace
    expect(f).toContain('+ ".xcodeproj"');
    expect(f).toContain('"com.apple.product-type.application"');
  });

  it("reads Match's profile and certificate names from its own environment variables", async () => {
    const f = await fastfile();
    expect(f).toContain("Match::Utils.environment_variable_name_profile_name(app_identifier: bundle_id, type: Match.profile_type_sym(\"appstore\"))");
    expect(f).toContain("environment_variable_name_certificate_name");
    expect(f).toContain('code_sign_identity = "Apple Distribution" if code_sign_identity.empty?');
  });

  it("maps the bundle id to the profile in gym's export options", async () => {
    const f = await fastfile();
    expect(f).toContain('export_method: "app-store"');
    expect(f).toContain("export_team_id: team_id");
    expect(f).toContain('signingStyle: "manual"');
    expect(f).toContain("provisioningProfiles: { bundle_id => profile_name }");
  });

  it("sets the build number in Info.plist (not app.json) and reads TestFlight only with an API key", async () => {
    const f = await fastfile();
    expect(f).toContain('set_info_plist_value(path: plist_path, key: "CFBundleVersion", value: build_number.to_s)');
    expect(f).toContain("latest_testflight_build_number(api_key: api_key, app_identifier: bundle_id, initial_build_number: 0)");
    expect(f).toContain('ENV["APP_STORE_CONNECT_API_KEY_KEY_ID"]');
    expect(f).toContain("latest_build_number + 1");
    expect(f).toContain("SHIPYARD_BUILD_NUMBER=");
    expect(f).toContain('.gsub("__BUILD_NUMBER__", build_number.to_s)');
    // the TestFlight read must happen before the Info.plist edit
    expect(f.indexOf("latest_testflight_build_number(")).toBeLessThan(f.indexOf("set_info_plist_value("));
  });

  it("escapes config values into Ruby strings", async () => {
    const f = await fastfile(config({ bundleId: 'com.x"#{evil}' }));
    expect(f).toContain('bundle_id = "com.x\\"\\#{evil}"');
    const r = spawnSync("ruby", ["-c", join(dir, "fastlane", "Fastfile")], { encoding: "utf-8" });
    expect(r.status).toBe(0);
  });
});

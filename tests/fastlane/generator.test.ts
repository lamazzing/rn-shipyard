import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateFastfile,
  generateMatchfile,
  generateAppfile,
} from "../../src/fastlane/generator.js";
import type { ShipyardConfig } from "../../src/core/config.js";

let testDir: string;

const sampleConfig: ShipyardConfig = {
  version: "1.0.0",
  createdAt: "2026-02-23T14:30:00Z",
  platforms: {
    ios: {
      enabled: true,
      signingMethod: "match",
      matchGitUrl: "git@github.com:user/certs.git",
      matchType: "appstore",
      teamId: "ABC123DEF4",
      bundleId: "com.example.testapp",
    },
    android: {
      enabled: true,
      keystorePath: ".shipyard/android/release.keystore",
      keystoreAlias: "release",
      serviceAccountKeyPath: "./play-sa.json",
    },
  },
  outputDir: "./output",
};

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "shipyard-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("generateFastfile keystore fallback", () => {
  const withKeystore = (keystorePath: string): ShipyardConfig => ({
    ...sampleConfig,
    platforms: { ...sampleConfig.platforms, android: { ...sampleConfig.platforms.android!, keystorePath } },
  });

  it("relativizes an absolute keystore inside the project", async () => {
    await generateFastfile(testDir, withKeystore(join(testDir, ".shipyard/android/release.keystore")), "App");
    const content = await readFile(join(testDir, "fastlane", "Fastfile"), "utf-8");
    expect(content).toContain('options[:keystore_path] || ".shipyard/android/release.keystore"');
    expect(content).not.toContain(testDir);
  });

  it.each(["/Users/someone/keys/release.keystore", "~/keys/release.keystore", "../outside.keystore"])(
    "omits the fallback for %s",
    async (p) => {
      await generateFastfile(testDir, withKeystore(p), "App");
      const content = await readFile(join(testDir, "fastlane", "Fastfile"), "utf-8");
      expect(content).toContain('"android.injected.signing.store.file" => options[:keystore_path],');
      expect(content).not.toContain("/Users/");
      expect(content).not.toContain("~/");
      expect(content).not.toContain("outside.keystore");
    }
  );
});

describe("generateFastfile", () => {
  it("generates Fastfile with iOS and Android lanes", async () => {
    await generateFastfile(testDir, sampleConfig, "TestApp");
    const content = await readFile(join(testDir, "fastlane", "Fastfile"), "utf-8");

    expect(content).toContain("platform :ios do");
    expect(content).toContain("platform :android do");
    expect(content).toContain('lane :build');
    expect(content).toContain('lane :submit');
    expect(content).toContain("TestApp");
    expect(content).toContain("appstore");
    expect(content).toContain("ABC123DEF4");
  });

  it("generates Fastfile with only iOS when no Android config", async () => {
    const iosOnly: ShipyardConfig = {
      ...sampleConfig,
      platforms: { ios: sampleConfig.platforms.ios },
    };
    await generateFastfile(testDir, iosOnly, "TestApp");
    const content = await readFile(join(testDir, "fastlane", "Fastfile"), "utf-8");

    expect(content).toContain("platform :ios do");
    expect(content).not.toContain("platform :android do");
  });
});

describe("generateMatchfile", () => {
  it("generates Matchfile with correct values", async () => {
    await generateMatchfile(testDir, sampleConfig);
    const content = await readFile(join(testDir, "fastlane", "Matchfile"), "utf-8");

    expect(content).toContain("git@github.com:user/certs.git");
    expect(content).toContain("appstore");
    expect(content).toContain("com.example.testapp");
    expect(content).toContain("ABC123DEF4");
  });
});

describe("generateAppfile", () => {
  it("generates Appfile with identifiers", async () => {
    await generateAppfile(testDir, sampleConfig, "dev@test.com", "com.example.testapp");
    const content = await readFile(join(testDir, "fastlane", "Appfile"), "utf-8");

    expect(content).toContain("com.example.testapp");
    expect(content).toContain("dev@test.com");
    expect(content).toContain("ABC123DEF4");
  });
});

describe("generated Fastfile: phase-1 hooks", () => {
  it("the build lane keeps match's own git_url (no SHIPYARD_MATCH_GIT_URL): the redirect to the local clone is done by git env", async () => {
    await generateFastfile(testDir, sampleConfig, "TestApp");
    const content = await readFile(join(testDir, "fastlane", "Fastfile"), "utf-8");
    expect(content).not.toContain("SHIPYARD_MATCH_GIT_URL");
    expect(content).not.toMatch(/git_url\s*[:=]/);
    // the configured URL itself is never written into the Fastfile (it lives in the Matchfile)
    expect(content).not.toContain("git@github.com:user/certs.git");
  });

  it("has an internal Apple login lane that logs in like pilot does, and the submit lane loads the ASC key from env", async () => {
    await generateFastfile(testDir, sampleConfig, "TestApp");
    const content = await readFile(join(testDir, "fastlane", "Fastfile"), "utf-8");
    expect(content).toContain("lane :shipyard_apple_login");
    expect(content).toContain("Spaceship::ConnectAPI.login(user, use_portal: false, use_tunes: true, skip_select_team: true)");
    expect(content).toContain("app_store_connect_api_key");
  });

  it("is valid Ruby (ruby -c)", async () => {
    const { spawnSync } = await import("node:child_process");
    await generateFastfile(testDir, sampleConfig, "TestApp");
    const r = spawnSync("ruby", ["-c", join(testDir, "fastlane", "Fastfile")], { encoding: "utf8" });
    if (r.error) return; // no ruby on this machine
    expect(r.stdout + r.stderr).toContain("Syntax OK");
  });
});

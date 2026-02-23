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

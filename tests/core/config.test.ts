import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readConfig,
  writeConfig,
  configExists,
  type ShipyardConfig,
} from "../../src/core/config.js";

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
      bundleId: "com.example.app",
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

describe("configExists", () => {
  it("returns false when no config", async () => {
    expect(await configExists(testDir)).toBe(false);
  });

  it("returns true when config exists", async () => {
    await mkdir(join(testDir, ".shipyard"), { recursive: true });
    await writeFile(
      join(testDir, ".shipyard", "config.json"),
      JSON.stringify(sampleConfig)
    );
    expect(await configExists(testDir)).toBe(true);
  });
});

describe("writeConfig", () => {
  it("creates .shipyard directory and writes config", async () => {
    await writeConfig(testDir, sampleConfig);
    expect(await configExists(testDir)).toBe(true);
  });
});

describe("readConfig", () => {
  it("reads existing config", async () => {
    await writeConfig(testDir, sampleConfig);
    const config = await readConfig(testDir);
    expect(config.version).toBe("1.0.0");
    expect(config.platforms.ios?.teamId).toBe("ABC123DEF4");
    expect(config.platforms.android?.keystoreAlias).toBe("release");
  });

  it("throws on missing config", async () => {
    await expect(readConfig(testDir)).rejects.toThrow("config.json not found");
  });

  it("throws on invalid JSON", async () => {
    await mkdir(join(testDir, ".shipyard"), { recursive: true });
    await writeFile(join(testDir, ".shipyard", "config.json"), "bad json");
    await expect(readConfig(testDir)).rejects.toThrow("invalid format");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkVersion } from "../../src/core/version-check.js";
import { appendHistory } from "../../src/core/history.js";

let testDir: string;

function writeAppJson(dir: string, version: string, buildNumber: string, versionCode: number) {
  return writeFile(
    join(dir, "app.json"),
    JSON.stringify({
      expo: {
        name: "TestApp",
        slug: "test-app",
        version,
        ios: { bundleIdentifier: "com.test.app", buildNumber },
        android: { package: "com.test.app", versionCode },
      },
    })
  );
}

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "shipyard-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("checkVersion", () => {
  it("returns no warning when no previous builds", async () => {
    await writeAppJson(testDir, "1.0.0", "1", 1);
    const result = await checkVersion(testDir);
    expect(result.shouldWarn).toBe(false);
    expect(result.message).toContain("No previous builds");
  });

  it("warns when same iOS version and build number", async () => {
    await writeAppJson(testDir, "1.0.0", "1", 1);
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {
        ios: {
          status: "success",
          version: "1.0.0",
          buildNumber: "1",
          durationSeconds: 60,
          error: null,
        },
      },
    });

    const result = await checkVersion(testDir);
    expect(result.shouldWarn).toBe(true);
    expect(result.message).toContain("1.0.0");
    expect(result.message).toContain("bump");
  });

  it("warns when same Android version and versionCode", async () => {
    await writeAppJson(testDir, "1.0.0", "2", 1);
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {
        android: {
          status: "success",
          version: "1.0.0",
          versionCode: 1,
          durationSeconds: 60,
          error: null,
        },
      },
    });

    const result = await checkVersion(testDir);
    expect(result.shouldWarn).toBe(true);
    expect(result.message).toContain("versionCode");
  });

  it("no warning when version is different", async () => {
    await writeAppJson(testDir, "1.1.0", "2", 2);
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {
        ios: {
          status: "success",
          version: "1.0.0",
          buildNumber: "1",
          durationSeconds: 60,
          error: null,
        },
      },
    });

    const result = await checkVersion(testDir);
    expect(result.shouldWarn).toBe(false);
  });

  it("no warning when build number is different", async () => {
    await writeAppJson(testDir, "1.0.0", "2", 1);
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {
        ios: {
          status: "success",
          version: "1.0.0",
          buildNumber: "1",
          durationSeconds: 60,
          error: null,
        },
      },
    });

    const result = await checkVersion(testDir);
    expect(result.shouldWarn).toBe(false);
  });
});

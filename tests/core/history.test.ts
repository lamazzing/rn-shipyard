import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readHistory,
  appendHistory,
  queryHistory,
  getLastSuccessfulBuild,
} from "../../src/core/history.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "shipyard-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("readHistory", () => {
  it("returns empty entries when no file exists", async () => {
    const history = await readHistory(testDir);
    expect(history.entries).toEqual([]);
  });
});

describe("appendHistory", () => {
  it("appends entry with auto-generated id and timestamp", async () => {
    const entry = await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {
        ios: {
          status: "success",
          version: "1.0.0",
          buildNumber: "1",
          artifactPath: "output/App.ipa",
          durationSeconds: 120,
          error: null,
        },
      },
    });

    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(entry.command).toBe("build");

    const history = await readHistory(testDir);
    expect(history.entries).toHaveLength(1);
  });

  it("appends multiple entries", async () => {
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {},
    });
    await appendHistory(testDir, {
      command: "submit",
      profile: "production",
      platforms: {},
    });

    const history = await readHistory(testDir);
    expect(history.entries).toHaveLength(2);
  });
});

describe("queryHistory", () => {
  it("returns entries filtered by platform", async () => {
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {
        ios: {
          status: "success",
          version: "1.0.0",
          durationSeconds: 60,
          error: null,
        },
      },
    });
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {
        android: {
          status: "success",
          version: "1.0.0",
          versionCode: 1,
          durationSeconds: 45,
          error: null,
        },
      },
    });

    const iosEntries = await queryHistory(testDir, { platform: "ios" });
    expect(iosEntries).toHaveLength(1);

    const androidEntries = await queryHistory(testDir, { platform: "android" });
    expect(androidEntries).toHaveLength(1);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await appendHistory(testDir, {
        command: "build",
        profile: "production",
        platforms: {},
      });
    }

    const limited = await queryHistory(testDir, { limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("returns most recent first", async () => {
    await appendHistory(testDir, {
      command: "build",
      profile: "development",
      platforms: {},
    });
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {},
    });

    const entries = await queryHistory(testDir);
    expect(entries[0].profile).toBe("production");
  });
});

describe("getLastSuccessfulBuild", () => {
  it("returns undefined when no builds exist", () => {
    const result = getLastSuccessfulBuild({ entries: [] });
    expect(result).toBeUndefined();
  });

  it("finds last successful build", async () => {
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
    await appendHistory(testDir, {
      command: "build",
      profile: "production",
      platforms: {
        ios: {
          status: "error",
          version: "1.1.0",
          durationSeconds: 10,
          error: "Build failed",
        },
      },
    });

    const history = await readHistory(testDir);
    const last = getLastSuccessfulBuild(history, "ios");
    expect(last?.platforms.ios?.version).toBe("1.0.0");
  });

  it("skips submit entries", async () => {
    await appendHistory(testDir, {
      command: "submit",
      profile: "production",
      platforms: {
        ios: {
          status: "success",
          version: "1.0.0",
          durationSeconds: 30,
          error: null,
        },
      },
    });

    const history = await readHistory(testDir);
    const last = getLastSuccessfulBuild(history, "ios");
    expect(last).toBeUndefined();
  });
});

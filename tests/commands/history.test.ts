import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/history.js", () => ({
  queryHistory: vi.fn(),
}));

import { queryHistory } from "../../src/core/history.js";
import type { HistoryEntry } from "../../src/core/history.js";

const mockedQueryHistory = vi.mocked(queryHistory);

const sampleEntry: HistoryEntry = {
  id: "abc12345",
  timestamp: "2026-02-23T14:30:00Z",
  command: "build",
  profile: "production",
  platforms: {
    ios: {
      status: "success",
      version: "1.2.0",
      buildNumber: "42",
      artifactPath: "output/TestApp-1.2.0-42.ipa",
      durationSeconds: 185,
      error: null,
    },
    android: {
      status: "success",
      version: "1.2.0",
      versionCode: 42,
      artifactPath: "output/TestApp-1.2.0-42.aab",
      durationSeconds: 120,
      error: null,
    },
  },
};

const submitEntry: HistoryEntry = {
  id: "def67890",
  timestamp: "2026-02-23T14:35:00Z",
  command: "submit",
  profile: "production",
  platforms: {
    ios: {
      status: "success",
      version: "1.2.0",
      buildNumber: "42",
      durationSeconds: 60,
      error: null,
    },
    android: {
      status: "skipped",
      version: "1.2.0",
      versionCode: 42,
      durationSeconds: 0,
      error: "No service account configured",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// We test the history command indirectly by testing behavior through queryHistory mock
// and verifying JSON output via console.log spy

describe("history command", () => {
  it("shows empty message when no history", async () => {
    mockedQueryHistory.mockResolvedValueOnce([]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { default: historyCmd } = await import("../../src/commands/history.js");

    await historyCmd({
      json: false,
      limit: "10",
      nonInteractive: false,
    });

    // Logger.info is called which uses console.log
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.anything(),
      "No builds yet. Run 'rn-shipyard build' to get started."
    );
    consoleSpy.mockRestore();
  });

  it("outputs valid JSON in json mode with entries", async () => {
    mockedQueryHistory.mockResolvedValueOnce([sampleEntry, submitEntry]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { default: historyCmd } = await import("../../src/commands/history.js");

    await historyCmd({
      json: true,
      limit: "10",
      nonInteractive: false,
    });

    const jsonOutput = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0].id).toBe("abc12345");
    consoleSpy.mockRestore();
  });

  it("outputs empty array JSON when no history in json mode", async () => {
    mockedQueryHistory.mockResolvedValueOnce([]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { default: historyCmd } = await import("../../src/commands/history.js");

    await historyCmd({
      json: true,
      limit: "10",
      nonInteractive: false,
    });

    const jsonOutput = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.entries).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it("passes platform filter to queryHistory", async () => {
    mockedQueryHistory.mockResolvedValueOnce([]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { default: historyCmd } = await import("../../src/commands/history.js");

    await historyCmd({
      platform: "ios",
      json: true,
      limit: "5",
      nonInteractive: false,
    });

    expect(mockedQueryHistory).toHaveBeenCalledWith(
      expect.any(String),
      { platform: "ios", limit: 5 }
    );
    consoleSpy.mockRestore();
  });

  it("renders table output with entries in text mode", async () => {
    mockedQueryHistory.mockResolvedValueOnce([sampleEntry]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { default: historyCmd } = await import("../../src/commands/history.js");

    await historyCmd({
      json: false,
      limit: "10",
      nonInteractive: false,
    });

    // Table output should contain platform and status info
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("build");
    expect(output).toContain("production");
    expect(output).toContain("1.2.0");
    consoleSpy.mockRestore();
  });
});

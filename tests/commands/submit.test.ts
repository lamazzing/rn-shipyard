import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/fastlane/runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/fastlane/runner.js")>(
    "../../src/fastlane/runner.js"
  );
  return { ...actual, runFastlane: vi.fn() };
});

vi.mock("../../src/core/config.js", () => ({
  configExists: vi.fn(),
  readConfig: vi.fn(),
}));

vi.mock("../../src/core/eas-parser.js", () => ({
  parseEasConfig: vi.fn(),
}));

vi.mock("../../src/core/history.js", () => ({
  readHistory: vi.fn(),
  appendHistory: vi.fn(),
  getLastSuccessfulBuild: vi.fn(),
}));

import { runFastlane } from "../../src/fastlane/runner.js";
import { configExists, readConfig } from "../../src/core/config.js";
import { parseEasConfig } from "../../src/core/eas-parser.js";
import { readHistory, appendHistory, getLastSuccessfulBuild } from "../../src/core/history.js";
import { submitIos } from "../../src/platforms/ios/submit.js";
import { submitAndroid } from "../../src/platforms/android/submit.js";

const mockedRunFastlane = vi.mocked(runFastlane);
const mockedConfigExists = vi.mocked(configExists);
const mockedReadConfig = vi.mocked(readConfig);
const mockedParseEasConfig = vi.mocked(parseEasConfig);
const mockedReadHistory = vi.mocked(readHistory);
const mockedAppendHistory = vi.mocked(appendHistory);
const mockedGetLastSuccessfulBuild = vi.mocked(getLastSuccessfulBuild);

const testConfig = {
  version: "1.0.0",
  createdAt: "2026-02-23T14:30:00Z",
  platforms: {
    ios: {
      enabled: true,
      signingMethod: "match" as const,
      matchGitUrl: "git@github.com:user/certs.git",
      matchType: "appstore",
      teamId: "ABC123DEF4",
      bundleId: "com.example.testapp",
    },
    android: {
      enabled: true,
      keystorePath: ".shipyard/android/release.keystore",
      keystoreAlias: "release",
      serviceAccountKeyPath: "./play-service-account.json",
    },
  },
  outputDir: "./output",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("submitIos", () => {
  it("returns success when fastlane pilot succeeds", async () => {
    mockedRunFastlane.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      output: "Upload succeeded",
      durationSeconds: 60,
    });

    const result = await submitIos({
      ipaPath: "/tmp/test/output/TestApp-1.2.0-42.ipa",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("success");
    expect(result.durationSeconds).toBe(60);
  });

  it("returns error when fastlane pilot fails", async () => {
    mockedRunFastlane.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      output: "Authentication failed",
      durationSeconds: 5,
    });

    const result = await submitIos({
      ipaPath: "/tmp/test/output/TestApp-1.2.0-42.ipa",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Authentication failed");
  });
});

let saPath: string;
beforeAll(async () => {
  const d = await mkdtemp(join(tmpdir(), "shipyard-submit-"));
  saPath = join(d, "play-service-account.json");
  await writeFile(saPath, "{}");
});

describe("submitAndroid", () => {
  it("returns success when fastlane supply succeeds", async () => {
    mockedRunFastlane.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      output: "Upload succeeded",
      durationSeconds: 45,
    });

    const result = await submitAndroid({
      aabPath: "/tmp/test/output/TestApp-1.2.0-42.aab",
      serviceAccountKeyPath: saPath,
      track: "internal",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("success");
    expect(result.durationSeconds).toBe(45);
  });

  it("returns skipped when no service account configured", async () => {
    const result = await submitAndroid({
      aabPath: "/tmp/test/output/TestApp-1.2.0-42.aab",
      serviceAccountKeyPath: undefined,
      track: "internal",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("skipped");
    expect(result.error).toContain("No Google Play service account configured");
  });

  it("returns error when fastlane supply fails", async () => {
    mockedRunFastlane.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      output: "Invalid service account",
      durationSeconds: 3,
    });

    const result = await submitAndroid({
      aabPath: "/tmp/test/output/TestApp-1.2.0-42.aab",
      serviceAccountKeyPath: saPath,
      track: "internal",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid service account");
  });

  it("passes track and release status to the supply lane", async () => {
    mockedRunFastlane.mockResolvedValueOnce({ success: true, exitCode: 0, output: "ok", durationSeconds: 1 });

    await submitAndroid({
      aabPath: "/tmp/test/a.aab",
      serviceAccountKeyPath: saPath,
      track: "internal",
      releaseStatus: "draft",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(mockedRunFastlane.mock.calls[0][2]).toMatchObject({
      aab_path: "/tmp/test/a.aab",
      track: "internal",
      release_status: "draft",
      service_account_key: saPath,
    });
  });

  it("defaults the release status to draft", async () => {
    mockedRunFastlane.mockResolvedValueOnce({ success: true, exitCode: 0, output: "ok", durationSeconds: 1 });
    await submitAndroid({
      aabPath: "/tmp/test/a.aab", serviceAccountKeyPath: saPath, track: "internal", projectDir: "/tmp/test", json: false,
    });
    expect(mockedRunFastlane.mock.calls[0][2]).toMatchObject({ release_status: "draft" });
  });

  it("dry run returns the exact command and never calls fastlane", async () => {
    const result = await submitAndroid({
      aabPath: "/tmp/test/a.aab",
      serviceAccountKeyPath: saPath,
      track: "internal",
      releaseStatus: "draft",
      dryRun: true,
      projectDir: "/tmp/test",
      json: false,
    });

    expect(mockedRunFastlane).not.toHaveBeenCalled();
    expect(result.command).toEqual([
      "fastlane", "android", "submit",
      "aab_path:/tmp/test/a.aab", "track:internal", "release_status:draft", `service_account_key:${saPath}`,
    ]);
  });

  it("errors when the service account file does not exist", async () => {
    const result = await submitAndroid({
      aabPath: "/tmp/test/a.aab", serviceAccountKeyPath: "/nonexistent/sa.json", track: "internal", projectDir: "/tmp/test", json: false,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("not found");
    expect(mockedRunFastlane).not.toHaveBeenCalled();
  });
});

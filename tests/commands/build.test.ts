import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({
  exec: vi.fn(),
}));

vi.mock("../../src/fastlane/runner.js", () => ({
  runFastlane: vi.fn(),
}));

vi.mock("../../src/core/config.js", () => ({
  configExists: vi.fn(),
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}));

vi.mock("../../src/core/eas-parser.js", () => ({
  parseEasConfig: vi.fn(),
  parseAppConfig: vi.fn(),
}));

vi.mock("../../src/core/history.js", () => ({
  appendHistory: vi.fn(),
  readHistory: vi.fn(),
  queryHistory: vi.fn(),
  getLastSuccessfulBuild: vi.fn(),
}));

vi.mock("../../src/core/version-check.js", () => ({
  checkVersion: vi.fn(),
}));

import { exec } from "../../src/utils/shell.js";
import { runFastlane } from "../../src/fastlane/runner.js";
import { configExists, readConfig } from "../../src/core/config.js";
import { parseAppConfig } from "../../src/core/eas-parser.js";
import { appendHistory } from "../../src/core/history.js";
import { checkVersion } from "../../src/core/version-check.js";
import { buildIos } from "../../src/platforms/ios/build.js";
import { buildAndroid } from "../../src/platforms/android/build.js";

const mockedExec = vi.mocked(exec);
const mockedRunFastlane = vi.mocked(runFastlane);
const mockedConfigExists = vi.mocked(configExists);
const mockedReadConfig = vi.mocked(readConfig);
const mockedParseAppConfig = vi.mocked(parseAppConfig);
const mockedAppendHistory = vi.mocked(appendHistory);
const mockedCheckVersion = vi.mocked(checkVersion);

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

const testAppConfig = {
  name: "TestApp",
  slug: "test-app",
  version: "1.2.0",
  ios: { bundleIdentifier: "com.example.testapp", buildNumber: "42" },
  android: { package: "com.example.testapp", versionCode: 42 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildIos", () => {
  it("returns success when fastlane succeeds", async () => {
    mockedRunFastlane.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      output: "Build succeeded",
      durationSeconds: 120,
    });

    const result = await buildIos({
      config: testConfig.platforms.ios,
      outputDir: "./output",
      appName: "TestApp",
      outputName: "TestApp-1.2.0-42.ipa",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("success");
    expect(result.artifactPath).toBe("./output/TestApp-1.2.0-42.ipa");
    expect(result.durationSeconds).toBe(120);
  });

  it("returns error when fastlane fails", async () => {
    mockedRunFastlane.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      output: "Build failed: signing error",
      durationSeconds: 10,
    });

    const result = await buildIos({
      config: testConfig.platforms.ios,
      outputDir: "./output",
      appName: "TestApp",
      outputName: "TestApp-1.2.0-42.ipa",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Build failed");
    expect(result.durationSeconds).toBe(10);
  });
});

describe("buildAndroid", () => {
  it("returns success when fastlane succeeds", async () => {
    mockedRunFastlane.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      output: "Build succeeded",
      durationSeconds: 90,
    });

    const result = await buildAndroid({
      config: testConfig.platforms.android,
      outputDir: "./output",
      outputName: "TestApp-1.2.0-42.aab",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("success");
    expect(result.artifactPath).toBe("./output/TestApp-1.2.0-42.aab");
    expect(result.durationSeconds).toBe(90);
  });

  it("returns error when fastlane fails", async () => {
    mockedRunFastlane.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      output: "Gradle build failed",
      durationSeconds: 5,
    });

    const result = await buildAndroid({
      config: testConfig.platforms.android,
      outputDir: "./output",
      outputName: "TestApp-1.2.0-42.aab",
      projectDir: "/tmp/test",
      json: false,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Gradle build failed");
  });
});

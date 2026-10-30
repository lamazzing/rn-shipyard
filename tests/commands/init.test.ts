import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({
  exec: vi.fn(),
}));

vi.mock("../../src/core/eas-parser.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/eas-parser.js")>()),
  parseEasConfig: vi.fn(),
  parseAppConfig: vi.fn(),
}));

vi.mock("../../src/core/config.js", () => ({
  writeConfig: vi.fn(),
  configExists: vi.fn(),
  readConfig: vi.fn(),
}));

vi.mock("../../src/fastlane/generator.js", () => ({
  generateAll: vi.fn(),
}));

vi.mock("../../src/platforms/ios/signing.js", () => ({
  setupMatch: vi.fn(),
}));

vi.mock("../../src/platforms/android/keystore.js", () => ({
  generateKeystore: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises"
  );
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockRejectedValue(new Error("not found")),
  };
});

import { parseEasConfig, parseAppConfig } from "../../src/core/eas-parser.js";
import { writeConfig } from "../../src/core/config.js";
import { generateAll } from "../../src/fastlane/generator.js";
import { setupMatch } from "../../src/platforms/ios/signing.js";
import { generateKeystore } from "../../src/platforms/android/keystore.js";

const mockedParseEasConfig = vi.mocked(parseEasConfig);
const mockedParseAppConfig = vi.mocked(parseAppConfig);
const mockedWriteConfig = vi.mocked(writeConfig);
const mockedGenerateAll = vi.mocked(generateAll);
const mockedSetupMatch = vi.mocked(setupMatch);
const mockedGenerateKeystore = vi.mocked(generateKeystore);

const testAppConfig = {
  name: "TestApp",
  slug: "test-app",
  version: "1.0.0",
  ios: { bundleIdentifier: "com.example.testapp", buildNumber: "1" },
  android: { package: "com.example.testapp", versionCode: 1 },
};

const testEasConfig = {
  build: {
    production: {
      distribution: "store",
    },
  },
  submit: {
    production: {
      ios: {
        appleId: "dev@example.com",
        appleTeamId: "ABC123DEF4",
      },
      android: {
        serviceAccountKeyPath: "./play-service-account.json",
        track: "internal",
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedParseAppConfig.mockResolvedValue(testAppConfig);
  mockedParseEasConfig.mockResolvedValue(testEasConfig);
  mockedWriteConfig.mockResolvedValue(undefined);
  mockedGenerateAll.mockResolvedValue(undefined);
  mockedSetupMatch.mockResolvedValue({ success: true });
  mockedGenerateKeystore.mockResolvedValue({
    created: true,
    path: ".shipyard/android/release.keystore",
  });
});

describe("init command", () => {
  it("writes config with iOS settings in non-interactive mode", async () => {
    const originalEnv = { ...process.env };
    process.env.APPLE_TEAM_ID = "ABC123DEF4";
    process.env.MATCH_GIT_URL = "git@github.com:user/certs.git";
    process.env.MATCH_PASSWORD = "testpass";
    process.env.ANDROID_KEYSTORE_PASSWORD = "keystorepass";

    const initCmd = (await import("../../src/commands/init.js")).default;

    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);

    await initCmd({
      platform: "all",
      json: false,
      nonInteractive: true,
    });

    expect(mockedWriteConfig).toHaveBeenCalledOnce();
    const configArg = mockedWriteConfig.mock.calls[0][1];
    expect(configArg.platforms.ios?.enabled).toBe(true);
    expect(configArg.platforms.ios?.teamId).toBe("ABC123DEF4");
    expect(configArg.platforms.ios?.matchGitUrl).toBe(
      "git@github.com:user/certs.git"
    );
    expect(configArg.platforms.android?.enabled).toBe(true);

    expect(mockedGenerateAll).toHaveBeenCalledOnce();

    mockExit.mockRestore();
    process.env = originalEnv;
  });

  it("generates Fastlane files during init", async () => {
    const originalEnv = { ...process.env };
    process.env.APPLE_TEAM_ID = "ABC123DEF4";
    process.env.MATCH_GIT_URL = "git@github.com:user/certs.git";
    process.env.ANDROID_KEYSTORE_PASSWORD = "keystorepass";

    const initCmd = (await import("../../src/commands/init.js")).default;

    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);

    await initCmd({
      platform: "all",
      json: false,
      nonInteractive: true,
    });

    expect(mockedGenerateAll).toHaveBeenCalledOnce();
    const [, , appName] = mockedGenerateAll.mock.calls[0];
    expect(appName).toBe("TestApp");

    mockExit.mockRestore();
    process.env = originalEnv;
  });

  it("generates keystore for android platform", async () => {
    const originalEnv = { ...process.env };
    process.env.ANDROID_KEYSTORE_PASSWORD = "testpass";

    const initCmd = (await import("../../src/commands/init.js")).default;

    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);

    await initCmd({
      platform: "android",
      json: false,
      nonInteractive: true,
    });

    expect(mockedGenerateKeystore).toHaveBeenCalledOnce();
    const keystoreOpts = mockedGenerateKeystore.mock.calls[0][0];
    expect(keystoreOpts.alias).toBe("release");
    expect(keystoreOpts.password).toBe("testpass");

    mockExit.mockRestore();
    process.env = originalEnv;
  });

  it("outputs JSON in json mode", async () => {
    const originalEnv = { ...process.env };
    process.env.APPLE_TEAM_ID = "ABC123DEF4";
    process.env.MATCH_GIT_URL = "git@github.com:user/certs.git";
    process.env.MATCH_PASSWORD = "testpass";
    process.env.ANDROID_KEYSTORE_PASSWORD = "keystorepass";

    const initCmd = (await import("../../src/commands/init.js")).default;

    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);

    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => {});

    await initCmd({
      platform: "all",
      json: true,
      nonInteractive: true,
    });

    // Should output JSON with success: true
    const jsonCalls = consoleSpy.mock.calls.filter((call) => {
      try {
        const parsed = JSON.parse(call[0] as string);
        return parsed.success === true;
      } catch {
        return false;
      }
    });
    expect(jsonCalls.length).toBeGreaterThan(0);

    consoleSpy.mockRestore();
    mockExit.mockRestore();
    process.env = originalEnv;
  });

  it("exits 2 when missing iOS config in non-interactive mode", async () => {
    const originalEnv = { ...process.env };
    delete process.env.APPLE_TEAM_ID;
    delete process.env.MATCH_GIT_URL;
    delete process.env.MATCH_PASSWORD;

    // Configure mocks to return eas config without iOS team ID
    mockedParseEasConfig.mockResolvedValue({
      build: {},
      submit: { production: {} },
    });

    const initCmd = (await import("../../src/commands/init.js")).default;

    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);

    await initCmd({
      platform: "ios",
      json: false,
      nonInteractive: true,
    });

    expect(mockExit).toHaveBeenCalledWith(2);

    mockExit.mockRestore();
    process.env = originalEnv;
  });
});

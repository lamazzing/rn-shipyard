import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

vi.mock("../../src/core/eas-parser.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/eas-parser.js")>()),
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
  // /bin/sh dotted-env probe (see src/platforms/android/shell-env.ts)
  mockedExec.mockResolvedValue({ exitCode: 0, stdout: "SHIPYARD_PROBE.DOTTED.NAME=probe-ok", stderr: "" });
});

describe("buildIos", () => {
  let iosDir: string;
  beforeEach(async () => {
    iosDir = await mkdtemp(join(tmpdir(), "shipyard-ios-"));
    await mkdir(join(iosDir, "ios", "Test App.xcworkspace"), { recursive: true });
  });

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
      projectDir: iosDir,
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
      projectDir: iosDir,
      json: false,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Build failed");
    expect(result.durationSeconds).toBe(10);
  });
});

describe("buildAndroid", () => {
  let dir: string;
  const creds = { keystorePassword: "store-secret-1", keyAlias: "alias1", keyPassword: "key-secret-2" };

  async function setup() {
    dir = await mkdtemp(join(tmpdir(), "shipyard-build-"));
    await mkdir(join(dir, "android", "app"), { recursive: true });
    await writeFile(
      join(dir, "android", "app", "build.gradle"),
      "android {\n    defaultConfig {\n        versionCode 1\n        versionName \"1.0\"\n    }\n}\n"
    );
    await writeFile(join(dir, "up.jks"), "x");
    await writeFile(join(dir, "up.json"), JSON.stringify(creds));
    return {
      config: {
        enabled: true,
        keystorePath: join(dir, "up.jks"),
        keystoreAlias: "ignored",
        credentialsPath: join(dir, "up.json"),
      },
    };
  }

  function fakeGradleOutput() {
    return async () => {
      const out = join(dir, "android", "app", "build", "outputs", "bundle", "release");
      await mkdir(out, { recursive: true });
      await writeFile(join(out, "app-release.aab"), "AAB");
      return { success: true, exitCode: 0, output: "Build succeeded", durationSeconds: 90 };
    };
  }

  it("copies the AAB to the output dir, patches versionCode, records the counter", async () => {
    const { config } = await setup();
    mockedRunFastlane.mockImplementationOnce(fakeGradleOutput());

    const result = await buildAndroid({
      config,
      outputDir: "./output",
      outputName: "TestApp-1.2.0-4.aab",
      projectDir: dir,
      versionCode: 4,
      json: false,
    });

    expect(result.status).toBe("success");
    expect(result.artifactPath).toBe("./output/TestApp-1.2.0-4.aab");
    expect(await readFile(join(dir, "output", "TestApp-1.2.0-4.aab"), "utf-8")).toBe("AAB");
    expect(await readFile(join(dir, "android", "app", "build.gradle"), "utf-8")).toContain("versionCode 4");
    expect(JSON.parse(await readFile(join(dir, ".shipyard", "version-code.json"), "utf-8"))).toEqual({
      android: { lastUsed: 4 },
    });
  });

  it("passes passwords by env and redacts them, never on the fastlane argv", async () => {
    const { config } = await setup();
    mockedRunFastlane.mockImplementationOnce(fakeGradleOutput());

    await buildAndroid({
      config, outputDir: "./output", outputName: "a.aab", projectDir: dir, versionCode: 2, json: true,
    });

    const [, , options, execOpts] = mockedRunFastlane.mock.calls[0];
    expect(JSON.stringify(options)).not.toContain("secret");
    expect(options.key_alias).toBe("alias1");
    expect(execOpts?.env?.ANDROID_KEYSTORE_PASSWORD).toBe("store-secret-1");
    expect(execOpts?.redact).toEqual(["store-secret-1", "key-secret-2"]);
  });

  it("fails (and does not bump the counter) when Gradle claims success but no AAB exists", async () => {
    const { config } = await setup();
    mockedRunFastlane.mockResolvedValueOnce({ success: true, exitCode: 0, output: "ok", durationSeconds: 1 });

    const result = await buildAndroid({
      config, outputDir: "./output", outputName: "a.aab", projectDir: dir, versionCode: 9, json: false,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("no .aab");
    await expect(readFile(join(dir, ".shipyard", "version-code.json"), "utf-8")).rejects.toThrow();
  });

  it("returns the tail of the fastlane output on failure", async () => {
    const { config } = await setup();
    mockedRunFastlane.mockResolvedValueOnce({
      success: false, exitCode: 1, output: "noise".repeat(400) + "Gradle build failed", durationSeconds: 5,
    });

    const result = await buildAndroid({
      config, outputDir: "./output", outputName: "a.aab", projectDir: dir, versionCode: 2, json: false,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Gradle build failed");
  });

  it("returns an error result when the keystore is missing", async () => {
    const { config } = await setup();
    const result = await buildAndroid({
      config: { ...config, keystorePath: join(dir, "nope.jks") },
      outputDir: "./output", outputName: "a.aab", projectDir: dir, versionCode: 2, json: false,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Keystore not found");
    expect(mockedRunFastlane).not.toHaveBeenCalled();
  });
});

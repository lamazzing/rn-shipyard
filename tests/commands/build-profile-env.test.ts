import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", async (orig) => ({
  ...(await orig<typeof import("../../src/utils/shell.js")>()),
  exec: vi.fn(),
}));
vi.mock("../../src/fastlane/runner.js", () => ({ runFastlane: vi.fn() }));
vi.mock("../../src/platforms/ios/workspace.js", () => ({ findIosWorkspace: vi.fn() }));
vi.mock("../../src/platforms/android/credentials.js", () => ({ loadAndroidCredentials: vi.fn() }));
vi.mock("../../src/platforms/android/gradle.js", () => ({
  setGradleVersionCode: vi.fn(),
  copyReleaseAab: vi.fn(),
  readGradleVersionCode: vi.fn(),
}));
vi.mock("../../src/platforms/android/shell-env.js", () => ({ assertShellKeepsDottedEnv: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { runFastlane } from "../../src/fastlane/runner.js";
import { findIosWorkspace } from "../../src/platforms/ios/workspace.js";
import { loadAndroidCredentials } from "../../src/platforms/android/credentials.js";
import { writeConfig } from "../../src/core/config.js";
import buildCmd from "../../src/commands/build.js";

let dir: string;
let cwd: string;

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "shipyard-profenv-"));
  await writeFile(join(dir, "package.json"), '{"name":"x"}\n');
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", ios: { bundleIdentifier: "com.x.app" }, android: { package: "com.x.app" } } })
  );
  await writeFile(
    join(dir, "eas.json"),
    JSON.stringify({
      build: {
        base: { env: { APP_VARIANT: "base", SHARED: "yes" } },
        production: {
          extends: "base",
          env: { APP_VARIANT: "production", ANDROID_KEYSTORE_PASSWORD: "from-profile", ANDROID_KEY_PASSWORD: "from-profile" },
        },
      },
    })
  );
  await writeConfig(dir, {
    version: "1.0.0",
    createdAt: "x",
    platforms: {
      ios: { enabled: true, teamId: "T", matchGitUrl: "git@x:y.git", bundleId: "com.x.app" } as never,
      android: { enabled: true, keystorePath: "/k.jks", keystoreAlias: "a" },
    },
    outputDir: "./output",
  });
  process.chdir(dir);
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  vi.mocked(findIosWorkspace).mockResolvedValue({ workspace: "ios/App.xcworkspace", scheme: "App" } as never);
  vi.mocked(loadAndroidCredentials).mockResolvedValue({
    keystorePath: "/k.jks",
    keyAlias: "a",
    keystorePassword: "real-store",
    keyPassword: "real-key",
  });
  vi.mocked(runFastlane).mockResolvedValue({ success: false, exitCode: 1, output: "stop", durationSeconds: 0 });
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
});

const opts = { platform: "all", profile: "production", submit: false, skipVersionCheck: true, json: true, nonInteractive: true };

describe("build-profile env reaches prebuild and fastlane", () => {
  it("passes the resolved env to expo prebuild and both fastlane builds; own secrets win", async () => {
    await buildCmd(opts);

    const prebuildEnv = vi.mocked(exec).mock.calls[0][2]?.env;
    expect(prebuildEnv).toEqual({ APP_VARIANT: "production", SHARED: "yes" });

    const calls = vi.mocked(runFastlane).mock.calls;
    const ios = calls.find((c) => c[0] === "ios")!;
    const android = calls.find((c) => c[0] === "android")!;
    expect(ios[3].env).toMatchObject({ APP_VARIANT: "production", SHARED: "yes" });
    expect(android[3].env).toMatchObject({ APP_VARIANT: "production", SHARED: "yes" });
    // rn-shipyard's own secret values win over the profile's, which is not even forwarded
    expect(android[3].env).toMatchObject({ ANDROID_KEYSTORE_PASSWORD: "real-store", ANDROID_KEY_PASSWORD: "real-key" });
    expect(ios[3].env).not.toHaveProperty("ANDROID_KEYSTORE_PASSWORD");
  });
});

describe("buildAndroid env precedence", () => {
  it("rn-shipyard's signing values override even a profileEnv that carries the same names", async () => {
    const { buildAndroid } = await import("../../src/platforms/android/build.js");
    await buildAndroid({
      config: { enabled: true, keystorePath: "/k.jks", keystoreAlias: "a" },
      outputDir: "./output",
      outputName: "x.aab",
      projectDir: dir,
      versionCode: 2,
      json: true,
      interactive: false,
      profileEnv: { ANDROID_KEYSTORE_PASSWORD: "evil", APP_VARIANT: "p" },
    });
    const env = vi.mocked(runFastlane).mock.calls.at(-1)![3].env!;
    expect(env.ANDROID_KEYSTORE_PASSWORD).toBe("real-store");
    expect(env.APP_VARIANT).toBe("p");
  });
});

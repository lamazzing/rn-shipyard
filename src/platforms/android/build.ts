import { runFastlane } from "../../fastlane/runner.js";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { Glob } from "node:fs";
import type { PlatformAndroidConfig } from "../../core/config.js";

export interface AndroidBuildOptions {
  config: PlatformAndroidConfig;
  outputDir: string;
  outputName: string;
  projectDir: string;
  json: boolean;
}

export interface BuildResult {
  status: "success" | "error";
  artifactPath?: string;
  durationSeconds: number;
  error?: string;
}

export async function buildAndroid(
  opts: AndroidBuildOptions
): Promise<BuildResult> {
  const keystorePath = join(opts.projectDir, opts.config.keystorePath);

  const result = await runFastlane(
    "android",
    "build",
    {
      keystore_path: keystorePath,
      key_alias: opts.config.keystoreAlias,
    },
    {
      json: opts.json,
      projectDir: opts.projectDir,
      env: {
        ANDROID_KEYSTORE_PASSWORD: process.env.ANDROID_KEYSTORE_PASSWORD ?? "",
        ANDROID_KEY_PASSWORD:
          process.env.ANDROID_KEY_PASSWORD ??
          process.env.ANDROID_KEYSTORE_PASSWORD ??
          "",
      },
    }
  );

  if (result.success) {
    // Fastlane gradle puts output in android/app/build/outputs/bundle/release/
    const gradleOutput = join(
      opts.projectDir,
      "android",
      "app",
      "build",
      "outputs",
      "bundle",
      "release"
    );

    return {
      status: "success",
      artifactPath: `${opts.outputDir}/${opts.outputName}`,
      durationSeconds: result.durationSeconds,
    };
  }

  return {
    status: "error",
    durationSeconds: result.durationSeconds,
    error: result.output.slice(0, 500),
  };
}

import { runFastlane } from "../../fastlane/runner.js";
import { join } from "node:path";
import type { PlatformAndroidConfig } from "../../core/config.js";
import { loadAndroidCredentials } from "./credentials.js";
import { setGradleVersionCode, copyReleaseAab } from "./gradle.js";
import { recordAndroidVersionCode } from "../../core/version-code.js";
import { assertShellKeepsDottedEnv } from "./shell-env.js";
import { extractBuildError } from "../../utils/build-errors.js";
import { ShipyardError } from "../../utils/errors.js";

export interface AndroidBuildOptions {
  config: PlatformAndroidConfig;
  outputDir: string;
  outputName: string;
  projectDir: string;
  versionCode: number;
  /** false when android/ is tracked in git: the user owns build.gradle, we never edit it */
  patchVersionCode?: boolean;
  json: boolean;
  /** Whether fastlane may use the terminal */
  interactive: boolean;
  /** eas.json build-profile env, passed to fastlane; the signing values below always win over it */
  profileEnv?: Record<string, string>;
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
  const started = Date.now();
  const elapsed = () => Math.round((Date.now() - started) / 1000);

  try {
    await assertShellKeepsDottedEnv();
    const creds = await loadAndroidCredentials(opts.projectDir, opts.config);
    if (opts.patchVersionCode !== false) {
      await setGradleVersionCode(opts.projectDir, opts.versionCode);
    }

    const result = await runFastlane(
      "android",
      "build",
      { keystore_path: creds.keystorePath, key_alias: creds.keyAlias },
      {
        json: opts.json,
        projectDir: opts.projectDir,
        // Passwords travel in the environment only (never argv, which `ps` shows).
        // Gradle turns ORG_GRADLE_PROJECT_<name> into project property <name>, which is
        // where the Android Gradle Plugin reads its injected signing config.
        env: {
          ...opts.profileEnv,
          ANDROID_KEYSTORE_PASSWORD: creds.keystorePassword,
          ANDROID_KEY_PASSWORD: creds.keyPassword,
          "ORG_GRADLE_PROJECT_android.injected.signing.store.password": creds.keystorePassword,
          "ORG_GRADLE_PROJECT_android.injected.signing.key.password": creds.keyPassword,
        },
        // defense in depth: scrub the passwords if a tool ever echoes them
        redact: [creds.keystorePassword, creds.keyPassword],
      }
    );

    if (!result.success) {
      return {
        status: "error",
        durationSeconds: result.durationSeconds,
        error: extractBuildError(result.output),
      };
    }

    const relative = `${opts.outputDir}/${opts.outputName}`;
    await copyReleaseAab(opts.projectDir, join(opts.projectDir, relative));
    await recordAndroidVersionCode(opts.projectDir, opts.versionCode);

    return {
      status: "success",
      artifactPath: relative,
      durationSeconds: elapsed(),
    };
  } catch (err) {
    if (err instanceof ShipyardError) {
      return { status: "error", durationSeconds: elapsed(), error: `${err.message}. ${err.fix}` };
    }
    throw err;
  }
}

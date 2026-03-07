import { join } from "node:path";
import { mkdir, rename, access, copyFile } from "node:fs/promises";
import { readConfig, configExists } from "../core/config.js";
import { parseEasConfig, parseAppConfig } from "../core/eas-parser.js";
import { appendHistory, type PlatformResult } from "../core/history.js";
import { checkVersion } from "../core/version-check.js";
import { buildIos } from "../platforms/ios/build.js";
import { buildAndroid } from "../platforms/android/build.js";
import { exec } from "../utils/shell.js";
import { createLogger } from "../utils/logger.js";
import { ShipyardError, exitCodeForError } from "../utils/errors.js";
import { printJson } from "../core/output.js";
import submitCmd from "./submit.js";

export interface BuildOptions {
  platform: string;
  profile: string;
  submit: boolean;
  skipVersionCheck: boolean;
  json: boolean;
  nonInteractive: boolean;
}

export default async function buildCmd(opts: BuildOptions): Promise<void> {
  const logger = createLogger(opts.json);
  const projectDir = process.cwd();

  // Validate init has been run
  if (!(await configExists(projectDir))) {
    const err = new ShipyardError(
      "MISSING_CONFIG_SHIPYARD",
      "Project not initialized. .shipyard/config.json not found.",
      "Run 'rn-shipyard init' to set up the project first"
    );
    if (opts.json) {
      printJson(err.toJSON());
    } else {
      logger.error(err.message);
      logger.info(`Fix: ${err.fix}`);
    }
    process.exit(2);
  }

  const config = await readConfig(projectDir);
  const appConfig = await parseAppConfig(projectDir);

  const doIos =
    (opts.platform === "all" || opts.platform === "ios") &&
    config.platforms.ios?.enabled === true;
  const doAndroid =
    (opts.platform === "all" || opts.platform === "android") &&
    config.platforms.android?.enabled === true;

  if (!doIos && !doAndroid) {
    const err = new ShipyardError(
      "NO_PLATFORMS",
      "No platforms enabled for build",
      "Run 'rn-shipyard init' with --platform to configure platforms"
    );
    if (opts.json) {
      printJson(err.toJSON());
    } else {
      logger.error(err.message);
    }
    process.exit(1);
  }

  // Version check
  if (!opts.skipVersionCheck) {
    const versionResult = await checkVersion(projectDir);
    if (versionResult.shouldWarn) {
      logger.warn(versionResult.message);
    }
  }

  // Run expo prebuild
  logger.info("Running expo prebuild --clean...");
  const prebuildResult = await exec("npx", ["expo", "prebuild", "--clean"], {
    cwd: projectDir,
    stream: !opts.json,
  });

  if (prebuildResult.exitCode !== 0) {
    const err = new ShipyardError(
      "PREBUILD_FAILED",
      "expo prebuild --clean failed",
      "Check your Expo project configuration and try running 'npx expo prebuild --clean' manually"
    );
    if (opts.json) {
      printJson({
        ...err.toJSON(),
        output: prebuildResult.stderr || prebuildResult.stdout,
      });
    } else {
      logger.error(err.message);
    }
    process.exit(1);
  }
  logger.success("Expo prebuild completed");

  // Ensure output directory exists
  const outputDir = join(projectDir, config.outputDir);
  await mkdir(outputDir, { recursive: true });

  const results: {
    ios?: PlatformResult;
    android?: PlatformResult;
  } = {};

  // Build iOS
  if (doIos) {
    logger.info("Building iOS...");
    const iosConfig = config.platforms.ios!;
    const outputName = `${appConfig.name}-${appConfig.version}-${appConfig.ios?.buildNumber ?? "0"}.ipa`;

    try {
      const iosBuildResult = await buildIos({
        config: iosConfig,
        outputDir: config.outputDir,
        appName: appConfig.name,
        outputName,
        projectDir,
        json: opts.json,
      });

      results.ios = {
        status: iosBuildResult.status,
        version: appConfig.version,
        buildNumber: appConfig.ios?.buildNumber,
        artifactPath: iosBuildResult.artifactPath,
        durationSeconds: iosBuildResult.durationSeconds,
        error: iosBuildResult.error ?? null,
      };

      if (iosBuildResult.status === "success") {
        logger.success(`iOS build succeeded: ${iosBuildResult.artifactPath}`);
      } else {
        logger.error(`iOS build failed: ${iosBuildResult.error}`);
      }
    } catch (err) {
      results.ios = {
        status: "error",
        version: appConfig.version,
        buildNumber: appConfig.ios?.buildNumber,
        durationSeconds: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      logger.error(`iOS build failed: ${results.ios.error}`);
    }
  }

  // Build Android
  if (doAndroid) {
    logger.info("Building Android...");
    const androidConfig = config.platforms.android!;
    const outputName = `${appConfig.name}-${appConfig.version}-${appConfig.android?.versionCode ?? "0"}.aab`;

    try {
      const androidBuildResult = await buildAndroid({
        config: androidConfig,
        outputDir: config.outputDir,
        outputName,
        projectDir,
        json: opts.json,
      });

      results.android = {
        status: androidBuildResult.status,
        version: appConfig.version,
        versionCode: appConfig.android?.versionCode,
        artifactPath: androidBuildResult.artifactPath,
        durationSeconds: androidBuildResult.durationSeconds,
        error: androidBuildResult.error ?? null,
      };

      if (androidBuildResult.status === "success") {
        logger.success(
          `Android build succeeded: ${androidBuildResult.artifactPath}`
        );
      } else {
        logger.error(`Android build failed: ${androidBuildResult.error}`);
      }
    } catch (err) {
      results.android = {
        status: "error",
        version: appConfig.version,
        versionCode: appConfig.android?.versionCode,
        durationSeconds: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      logger.error(`Android build failed: ${results.android.error}`);
    }
  }

  // Record history
  await appendHistory(projectDir, {
    command: "build",
    profile: opts.profile,
    platforms: results,
  });

  // Determine overall success
  const allSucceeded = Object.values(results).every(
    (r) => r.status === "success"
  );
  const anyFailed = Object.values(results).some((r) => r.status === "error");

  if (opts.json) {
    printJson({
      success: allSucceeded,
      platforms: results,
    });
  } else {
    console.log("");
    logger.info("Build Summary:");
    for (const [platform, result] of Object.entries(results)) {
      if (result.status === "success") {
        logger.success(
          `${platform}: ${result.artifactPath} (${result.durationSeconds}s)`
        );
      } else {
        logger.error(`${platform}: ${result.error}`);
      }
    }
  }

  // If --submit flag, trigger submit
  if (opts.submit && !anyFailed) {
    logger.info("Submitting builds...");
    await submitCmd({
      platform: opts.platform,
      json: opts.json,
      nonInteractive: opts.nonInteractive,
    });
    return;
  }

  process.exit(anyFailed ? 1 : 0);
}

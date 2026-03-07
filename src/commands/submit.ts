import { access } from "node:fs/promises";
import { join } from "node:path";
import { readConfig, configExists } from "../core/config.js";
import { readHistory, appendHistory, getLastSuccessfulBuild, type PlatformResult } from "../core/history.js";
import { parseEasConfig } from "../core/eas-parser.js";
import { submitIos } from "../platforms/ios/submit.js";
import { submitAndroid } from "../platforms/android/submit.js";
import { createLogger } from "../utils/logger.js";
import { ShipyardError } from "../utils/errors.js";
import { printJson } from "../core/output.js";

export interface SubmitOptions {
  platform: string;
  json: boolean;
  nonInteractive: boolean;
}

export default async function submitCmd(opts: SubmitOptions): Promise<void> {
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
  const history = await readHistory(projectDir);

  const doIos =
    (opts.platform === "all" || opts.platform === "ios") &&
    config.platforms.ios?.enabled === true;
  const doAndroid =
    (opts.platform === "all" || opts.platform === "android") &&
    config.platforms.android?.enabled === true;

  if (!doIos && !doAndroid) {
    const err = new ShipyardError(
      "NO_PLATFORMS",
      "No platforms enabled for submit",
      "Run 'rn-shipyard init' with --platform to configure platforms"
    );
    if (opts.json) {
      printJson(err.toJSON());
    } else {
      logger.error(err.message);
    }
    process.exit(1);
  }

  // Find latest build artifacts
  const lastBuild = getLastSuccessfulBuild(history);
  if (!lastBuild) {
    const err = new ShipyardError(
      "NO_ARTIFACTS",
      "No build artifacts found. Run 'rn-shipyard build' first.",
      "Run 'rn-shipyard build' to create build artifacts before submitting"
    );
    if (opts.json) {
      printJson(err.toJSON());
    } else {
      logger.error(err.message);
      logger.info(`Fix: ${err.fix}`);
    }
    process.exit(1);
  }

  // Read eas.json for submit config (track, service account, etc.)
  let easSubmitConfig: { ios?: Record<string, unknown>; android?: Record<string, unknown> } = {};
  try {
    const easConfig = await parseEasConfig(projectDir);
    easSubmitConfig = easConfig.submit?.production ?? {};
  } catch {
    // eas.json may not have submit config, that's OK
  }

  const results: {
    ios?: PlatformResult;
    android?: PlatformResult;
  } = {};

  // Submit iOS
  if (doIos) {
    const iosBuild = lastBuild.platforms.ios;
    if (!iosBuild || iosBuild.status !== "success" || !iosBuild.artifactPath) {
      results.ios = {
        status: "error",
        version: iosBuild?.version ?? "",
        buildNumber: iosBuild?.buildNumber,
        durationSeconds: 0,
        error: "No successful iOS build artifact found",
      };
      logger.error("No successful iOS build artifact found");
    } else {
      const artifactFullPath = join(projectDir, iosBuild.artifactPath);
      let artifactExists = false;
      try {
        await access(artifactFullPath);
        artifactExists = true;
      } catch {
        // artifact file missing
      }

      if (!artifactExists) {
        results.ios = {
          status: "error",
          version: iosBuild.version,
          buildNumber: iosBuild.buildNumber,
          durationSeconds: 0,
          error: `Build artifact not found at ${iosBuild.artifactPath}. Run 'rn-shipyard build' again.`,
        };
        logger.error(`iOS artifact not found: ${iosBuild.artifactPath}`);
      } else {
        logger.info(`Submitting iOS: ${iosBuild.artifactPath}`);
        try {
          const submitResult = await submitIos({
            ipaPath: artifactFullPath,
            projectDir,
            json: opts.json,
          });

          results.ios = {
            status: submitResult.status,
            version: iosBuild.version,
            buildNumber: iosBuild.buildNumber,
            durationSeconds: submitResult.durationSeconds,
            error: submitResult.error ?? null,
          };

          if (submitResult.status === "success") {
            logger.success(`iOS submitted successfully (${submitResult.durationSeconds}s)`);
          } else {
            logger.error(`iOS submit failed: ${submitResult.error}`);
          }
        } catch (err) {
          results.ios = {
            status: "error",
            version: iosBuild.version,
            buildNumber: iosBuild.buildNumber,
            durationSeconds: 0,
            error: err instanceof Error ? err.message : String(err),
          };
          logger.error(`iOS submit failed: ${results.ios.error}`);
        }
      }
    }
  }

  // Submit Android
  if (doAndroid) {
    const androidBuild = lastBuild.platforms.android;
    if (!androidBuild || androidBuild.status !== "success" || !androidBuild.artifactPath) {
      results.android = {
        status: "error",
        version: androidBuild?.version ?? "",
        versionCode: androidBuild?.versionCode,
        durationSeconds: 0,
        error: "No successful Android build artifact found",
      };
      logger.error("No successful Android build artifact found");
    } else {
      const artifactFullPath = join(projectDir, androidBuild.artifactPath);
      let artifactExists = false;
      try {
        await access(artifactFullPath);
        artifactExists = true;
      } catch {
        // artifact file missing
      }

      if (!artifactExists) {
        results.android = {
          status: "error",
          version: androidBuild.version,
          versionCode: androidBuild.versionCode,
          durationSeconds: 0,
          error: `Build artifact not found at ${androidBuild.artifactPath}. Run 'rn-shipyard build' again.`,
        };
        logger.error(`Android artifact not found: ${androidBuild.artifactPath}`);
      } else {
        // Determine service account path: env > config > eas.json
        const serviceAccountKeyPath =
          process.env.SUPPLY_JSON_KEY ??
          config.platforms.android?.serviceAccountKeyPath ??
          (easSubmitConfig.android?.serviceAccountKeyPath as string | undefined);

        const track =
          (easSubmitConfig.android?.track as string) ?? "internal";

        logger.info(`Submitting Android: ${androidBuild.artifactPath}`);
        try {
          const submitResult = await submitAndroid({
            aabPath: artifactFullPath,
            serviceAccountKeyPath,
            track,
            projectDir,
            json: opts.json,
          });

          results.android = {
            status: submitResult.status,
            version: androidBuild.version,
            versionCode: androidBuild.versionCode,
            durationSeconds: submitResult.durationSeconds,
            error: submitResult.error ?? null,
          };

          if (submitResult.status === "success") {
            logger.success(`Android submitted successfully (${submitResult.durationSeconds}s)`);
          } else if (submitResult.status === "skipped") {
            logger.warn(`Android submit skipped: ${submitResult.error}`);
          } else {
            logger.error(`Android submit failed: ${submitResult.error}`);
          }
        } catch (err) {
          results.android = {
            status: "error",
            version: androidBuild.version,
            versionCode: androidBuild.versionCode,
            durationSeconds: 0,
            error: err instanceof Error ? err.message : String(err),
          };
          logger.error(`Android submit failed: ${results.android.error}`);
        }
      }
    }
  }

  // Record history
  await appendHistory(projectDir, {
    command: "submit",
    profile: "production",
    platforms: results,
  });

  // Determine overall success: success or skipped = OK, error = fail
  const anyFailed = Object.values(results).some((r) => r.status === "error");

  if (opts.json) {
    printJson({
      success: !anyFailed,
      platforms: results,
    });
  } else {
    console.log("");
    logger.info("Submit Summary:");
    for (const [platform, result] of Object.entries(results)) {
      if (result.status === "success") {
        logger.success(`${platform}: submitted (${result.durationSeconds}s)`);
      } else if (result.status === "skipped") {
        logger.warn(`${platform}: skipped — ${result.error}`);
      } else {
        logger.error(`${platform}: ${result.error}`);
      }
    }
  }

  process.exit(anyFailed ? 1 : 0);
}

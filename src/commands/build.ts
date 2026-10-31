import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { readConfig, configExists } from "../core/config.js";
import { readProfileEnv, parseAppConfig, profileEnvWarnings } from "../core/eas-parser.js";
import { appendHistory, type PlatformResult } from "../core/history.js";
import { checkVersion } from "../core/version-check.js";
import { resolveAndroidVersionCode } from "../core/version-code.js";
import { resolveIosBuildNumber, BUILD_NUMBER_TOKEN } from "../core/build-number.js";
import { applyExpoEnvAliases, applyEasSubmitIos, hasAscApiKey } from "../utils/apple-env.js";
import { parseEasConfig } from "../core/eas-parser.js";
import { buildIos } from "../platforms/ios/build.js";
import { buildAndroid } from "../platforms/android/build.js";
import { exec } from "../utils/shell.js";
import { nativeDirState, nativeDirContaining, secretInNativeDirMessage, type NativePlatform } from "../utils/native-dirs.js";
import { readGradleVersionCode } from "../platforms/android/gradle.js";
import { getLastUsedAndroidVersionCode } from "../core/version-code.js";
import { snapshotFiles, restoreFiles, restoreFilesSync } from "../utils/snapshot.js";
import { isInteractive } from "../utils/interactive.js";
import { registerCleanup } from "../utils/cleanup.js";
import { createLogger } from "../utils/logger.js";
import { ShipyardError, exitCodeForError } from "../utils/errors.js";
import { printJson } from "../core/output.js";
import { runSubmit, appleLoginPhase, readIosAppleId, type AppleLoginOutcome } from "./submit.js";
import { runPreflight } from "./preflight.js";
import { noPlatformsError } from "./no-platforms.js";

export interface BuildOptions {
  platform: string;
  profile: string;
  submit: boolean;
  /** Skip the requirements pre-flight */
  skipChecks?: boolean;
  skipVersionCheck: boolean;
  versionCode?: string;
  /** iOS build number override (CFBundleVersion); must be greater than the last used one */
  buildNumber?: string;
  json: boolean;
  nonInteractive: boolean;
}

/** Prebuild decision per platform, reported in the JSON output as `prebuild.<platform>`. */
export type PrebuildAction = "generated" | "skipped_tracked" | "refused";

interface PrebuildInfo {
  action: PrebuildAction;
  error?: { code: string; message: string; fix: string };
}

/** File-name-safe artifact stem: app names may contain spaces, slashes or `..`. */
export function safeFileStem(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_") || "app";
}

function iosBuildNumberFrom(planned: number | undefined, used: number | undefined): string | undefined {
  const n = used ?? planned;
  return n !== undefined ? String(n) : undefined;
}

export default async function buildCmd(opts: BuildOptions): Promise<void> {
  const logger = createLogger(opts.json);
  const interactive = isInteractive(opts);
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

  // Requirements pre-flight (the same checks as `doctor`): fail fast, before any prompt or long step.
  const wantsIos = (opts.platform === "all" || opts.platform === "ios") && config.platforms.ios?.enabled === true;
  const wantsAndroid = (opts.platform === "all" || opts.platform === "android") && config.platforms.android?.enabled === true;
  if (!opts.skipChecks && (wantsIos || wantsAndroid)) {
    const platforms = [...(wantsIos ? (["ios"] as const) : []), ...(wantsAndroid ? (["android"] as const) : [])];
    const preflight = await runPreflight({
      projectDir,
      platforms: [...platforms],
      actions: platforms.flatMap((p) => (opts.submit ? [`build-${p}` as const, `submit-${p}` as const] : [`build-${p}` as const])),
      json: opts.json,
      nonInteractive: !interactive,
      logger,
    });
    if (!preflight.ok) {
      process.exit(preflight.exitCode);
      return;
    }
  }

  // Prompts up front: with --submit, the Apple login is asked now, not after a long build.
  let appleLogin: AppleLoginOutcome | undefined;
  if (opts.submit && wantsIos && interactive) {
    try {
      appleLogin = await appleLoginPhase({
        projectDir,
        interactive,
        appleId: await readIosAppleId(projectDir, opts.profile),
        warn: (m) => logger.warn(m),
      });
    } catch (err) {
      if (err instanceof ShipyardError && err.code === "INTERRUPTED") {
        logger.error("Interrupted");
        process.exit(130);
      }
      throw err;
    }
    if (appleLogin.status === "failed") {
      logger.error(`APPLE_LOGIN_FAILED: ${appleLogin.error ?? "Apple login failed"}`);
      logger.info("Fix: check your Apple ID and password, or use an App Store Connect API key (EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID, EXPO_ASC_API_KEY_PATH)");
      process.exit(1);
    }
  }
  // Build-profile env (eas.json build.<profile>.env, extends resolved) is applied when the Expo
  // config is evaluated (APP_VARIANT-style configs), to prebuild and to the platform builds.
  // Names rn-shipyard sets itself (signing secrets) are never taken from the profile.
  const profile = await readProfileEnv(projectDir, opts.profile);
  const profileEnv = profile.env;
  for (const w of profileEnvWarnings(profile, opts.profile)) logger.warn(w);
  const appConfig = await parseAppConfig(projectDir, profileEnv);
  if (appConfig.versionDefaulted) logger.warn(`version not set in ${appConfig.source}; Expo uses 1.0.0`);

  const doIos =
    (opts.platform === "all" || opts.platform === "ios") &&
    config.platforms.ios?.enabled === true;
  const doAndroid =
    (opts.platform === "all" || opts.platform === "android") &&
    config.platforms.android?.enabled === true;

  if (!doIos && !doAndroid) {
    const err = noPlatformsError("build", opts.platform);
    if (opts.json) {
      printJson(err.toJSON());
    } else {
      logger.error(err.message);
      logger.info(`Fix: ${err.fix}`);
    }
    process.exit(1);
  }

  // Version check
  if (!opts.skipVersionCheck) {
    const versionResult = await checkVersion(projectDir, appConfig);
    if (versionResult.shouldWarn) {
      logger.warn(versionResult.message);
    }
  }

  // Android versionCode: never reuse one (see src/core/version-code.ts)
  let androidVersionCode: number | undefined;
  if (doAndroid) {
    try {
      const resolved = await resolveAndroidVersionCode(
        projectDir,
        appConfig.android?.versionCode,
        opts.versionCode !== undefined ? Number(opts.versionCode) : undefined
      );
      androidVersionCode = resolved.versionCode;
      logger.info(
        `Android versionCode ${resolved.versionCode} (${resolved.source === "app.json" ? appConfig.source : resolved.source}, last used ${resolved.lastUsed})`
      );
    } catch (err) {
      if (err instanceof ShipyardError) {
        if (opts.json) printJson(err.toJSON());
        else {
          logger.error(err.message);
          logger.info(`Fix: ${err.fix}`);
        }
        process.exit(1);
      }
      throw err;
    }
  }

  // iOS build number (CFBundleVersion): never reuse one (see src/core/build-number.ts). The
  // lane raises it above the latest TestFlight build when an App Store Connect API key is set.
  let iosBuildNumber: number | undefined;
  let iosBuildNumberOverride = false;
  if (doIos) {
    // EXPO_ASC_* names and eas.json submit.<profile>.ios give the build lane the same App Store
    // Connect API key `submit` uses (applied to process.env, which fastlane inherits)
    applyExpoEnvAliases();
    try {
      applyEasSubmitIos((await parseEasConfig(projectDir)).submit?.[opts.profile]?.ios, projectDir);
    } catch {
      // no eas.json submit config: environment variables only
    }
    try {
      const resolved = await resolveIosBuildNumber(
        projectDir,
        appConfig.ios?.buildNumber,
        opts.buildNumber !== undefined ? Number(opts.buildNumber) : undefined
      );
      iosBuildNumber = resolved.buildNumber;
      iosBuildNumberOverride = resolved.source === "override";
      if (resolved.ignoredAppValue) {
        logger.warn(`ios.buildNumber "${resolved.ignoredAppValue}" in ${appConfig.source} is not an integer: ignored, rn-shipyard numbers iOS builds itself`);
      }
      if (hasAscApiKey(process.env)) {
        logger.info(
          `iOS build number ${resolved.buildNumber} (${resolved.source === "app.json" ? appConfig.source : resolved.source}, last used ${resolved.lastUsed}); the build lane continues after the latest TestFlight build if that is higher`
        );
      } else {
        logger.info(
          `iOS build number ${resolved.buildNumber} (${resolved.source === "app.json" ? appConfig.source : resolved.source}, last used ${resolved.lastUsed}). Set EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID and EXPO_ASC_API_KEY_PATH (or eas.json submit ascApi*) to continue from the latest TestFlight build number`
        );
      }
    } catch (err) {
      if (err instanceof ShipyardError) {
        if (opts.json) printJson(err.toJSON());
        else {
          logger.error(err.message);
          logger.info(`Fix: ${err.fix}`);
        }
        process.exit(1);
        return;
      }
      throw err;
    }
  }

  // Decide per platform whether expo prebuild may touch the native folder (EAS semantics):
  //  - absent or git-ignored -> generated (continuous native generation): prebuild --clean
  //  - tracked in git        -> hand-maintained native project: skip prebuild, build it as is
  //  - present, untracked and NOT ignored, or not a git repo -> `--clean` would delete work
  //    git cannot bring back: refuse that platform
  const results: {
    ios?: PlatformResult;
    android?: PlatformResult;
  } = {};
  const prebuild: Partial<Record<NativePlatform, PrebuildInfo>> = {};
  const wanted: NativePlatform[] = [...(doIos ? (["ios"] as const) : []), ...(doAndroid ? (["android"] as const) : [])];
  for (const platform of wanted) {
    const state = await nativeDirState(projectDir, platform);
    if (state === "tracked") {
      prebuild[platform] = { action: "skipped_tracked" };
      logger.info(
        `${platform}/ is tracked in git: skipping expo prebuild for ${platform} and building the committed native project as is`
      );
    } else if (state === "not-git" || state === "untracked") {
      const err =
        state === "not-git"
          ? new ShipyardError(
              "NATIVE_DIR_NOT_IN_GIT",
              `${platform}/ exists but this project is not under git, so rn-shipyard cannot tell whether it is generated or hand-written, and 'expo prebuild --clean' would delete it`,
              `Delete ${platform}/ to let rn-shipyard regenerate it, or put the project under git ('git init' and commit ${platform}/ if it is hand-written)`
            )
          : new ShipyardError(
              "NATIVE_DIR_UNTRACKED",
              `${platform}/ exists but is neither committed nor git-ignored, and 'expo prebuild --clean' would delete it for good`,
              `Commit ${platform}/ to keep it (rn-shipyard then builds it as is), add ${platform}/ to .gitignore to let rn-shipyard regenerate it, or delete it`
            );
      prebuild[platform] = {
        action: "refused",
        error: { code: err.code, message: err.message, fix: err.fix },
      };
      results[platform] = {
        status: "error",
        version: appConfig.version,
        ...(platform === "ios"
          ? { buildNumber: iosBuildNumber !== undefined ? String(iosBuildNumber) : undefined }
          : { versionCode: androidVersionCode }),
        durationSeconds: 0,
        error: `${err.message}. ${err.fix}`,
      };
      logger.error(`${platform}: ${err.message}`);
      logger.info(`Fix: ${err.fix}`);
    } else {
      prebuild[platform] = { action: "generated" };
    }
  }

  let toGenerate = wanted.filter((p) => prebuild[p]?.action === "generated");

  // `expo prebuild --clean` deletes ios/ and android/ recursively. An Android keystore or
  // credentials file stored inside a folder that is about to be regenerated would be destroyed:
  // refuse Android, and leave that folder alone, BEFORE prebuild runs.
  if (config.platforms.android) {
    const androidCfg = config.platforms.android;
    for (const [label, path] of [
      ["Keystore", androidCfg.keystorePath],
      ["Credentials file", androidCfg.credentialsPath],
    ] as const) {
      if (!path) continue;
      const dir = await nativeDirContaining(projectDir, path);
      if (!dir || !toGenerate.includes(dir)) continue; // tracked/absent/refused folders are never wiped
      const { message, fix } = secretInNativeDirMessage(label, path, dir);
      const err = new ShipyardError("SECRET_IN_NATIVE_DIR", message, fix);
      const info = { code: err.code, message: err.message, fix: err.fix };
      // The folder holding the secret is never regenerated. Android is refused too when it is
      // part of this run and not already refused; an ios-only run only loses ios.
      const refuse = new Set<NativePlatform>([dir]);
      if (doAndroid && !results.android) refuse.add("android");
      for (const platform of refuse) {
        prebuild[platform] = { action: "refused", error: info };
        results[platform] = {
          status: "error",
          version: appConfig.version,
          ...(platform === "ios"
            ? { buildNumber: iosBuildNumber !== undefined ? String(iosBuildNumber) : undefined }
            : { versionCode: androidVersionCode }),
          durationSeconds: 0,
          error: `${err.message}. ${err.fix}`,
        };
      }
      logger.error(`${[...refuse].join("+")}: ${err.message}`);
      logger.info(`Fix: ${err.fix}`);
      toGenerate = toGenerate.filter((p) => prebuild[p]?.action === "generated");
    }
  }
  if (toGenerate.length > 0) {
    const prebuildPlatform = toGenerate.length === 2 ? "all" : toGenerate[0];
    logger.info(`Running expo prebuild --clean --platform ${prebuildPlatform}...`);
    // expo prebuild rewrites package.json scripts (ios/android -> expo run:*) and its install
    // step can touch lockfiles. Snapshot them and always restore, whatever happens.
    const snapshot = await snapshotFiles(projectDir);
    const restoreProject = async () => {
      const report = await restoreFiles(projectDir, snapshot);
      if (report.restored.length > 0) {
        logger.info(`Restored ${report.restored.join(", ")} (expo prebuild had modified it)`);
      }
      for (const name of report.created) {
        logger.warn(`expo prebuild created ${name}, which did not exist before. Left in place: review it.`);
      }
      for (const name of report.failed) {
        logger.warn(`Could not restore ${name}: restore it manually with git checkout`);
      }
    };
    // On SIGINT/SIGTERM/SIGHUP the signal handler stops the prebuild process group first,
    // then runs this restore (see src/utils/signals.ts).
    const cleanup = registerCleanup(restoreProject, () => {
      restoreFilesSync(projectDir, snapshot); // last resort in process.on('exit'), idempotent
    });
    let prebuildResult: { exitCode: number; stdout: string; stderr: string };
    try {
      prebuildResult = await exec(
        "npx",
        ["expo", "prebuild", "--clean", "--platform", prebuildPlatform, ...(toGenerate.includes("ios") ? [] : ["--no-install"])],
        {
          cwd: projectDir,
          stream: !opts.json,
          detached: true,
          env: profileEnv,
        }
      );
    } catch (e) {
      // the process could not even start (e.g. npx missing)
      prebuildResult = { exitCode: 1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
    } finally {
      // run() joins a restore a signal handler already started (never two at once);
      // unregister only afterwards, so a crash mid-restore still reaches the sync fallback
      await cleanup.run();
      cleanup.unregister();
    }

    if (prebuildResult.exitCode !== 0) {
      const err = new ShipyardError(
        "PREBUILD_FAILED",
        "expo prebuild --clean failed",
        "Check your Expo project configuration and try running 'npx expo prebuild --clean' manually"
      );
      const stillBuildable = wanted.some((p) => prebuild[p]?.action === "skipped_tracked");
      if (!stillBuildable) {
        if (opts.json) {
          printJson({
            ...err.toJSON(),
            output: prebuildResult.stderr || prebuildResult.stdout,
            prebuild,
            warnings: logger.warnings,
          });
        } else {
          logger.error(err.message);
        }
        process.exit(1);
        return;
      }
      // a tracked native project can still be built: platforms are isolated
      logger.error(err.message);
      for (const platform of toGenerate) {
        results[platform] = {
          status: "error",
          version: appConfig.version,
          ...(platform === "ios"
            ? { buildNumber: iosBuildNumber !== undefined ? String(iosBuildNumber) : undefined }
            : { versionCode: androidVersionCode }),
          durationSeconds: 0,
          error: `${err.message}. ${err.fix}`,
        };
      }
    } else {
      logger.success("Expo prebuild completed");
    }
  }

  // Tracked android/: build.gradle belongs to the user. We do not patch versionCode; the value
  // in build.gradle is the one that ships, so use (and verify) that for naming and the counter.
  let patchAndroidVersionCode = true;
  if (doAndroid && prebuild.android?.action === "skipped_tracked") {
    patchAndroidVersionCode = false;
    const lastUsed = await getLastUsedAndroidVersionCode(projectDir);
    const inGradle = await readGradleVersionCode(projectDir);
    if (opts.versionCode !== undefined) {
      const msg = "--version-code cannot be applied: android/ is tracked in git, so versionCode is read from android/app/build.gradle";
      results.android = {
        status: "error",
        version: appConfig.version,
        versionCode: androidVersionCode,
        durationSeconds: 0,
        error: `${msg}. Edit versionCode in android/app/build.gradle and drop --version-code`,
      };
      logger.error(msg);
    } else if (inGradle === undefined) {
      const msg = "android/ is tracked in git and its versionCode in android/app/build.gradle(.kts) is not an integer literal (a property, an expression or several values), so rn-shipyard cannot tell which versionCode ships";
      results.android = {
        status: "error",
        version: appConfig.version,
        versionCode: androidVersionCode,
        durationSeconds: 0,
        error: `${msg}. Set it to a literal greater than ${lastUsed} (Groovy: versionCode ${lastUsed + 1}; Kotlin DSL: versionCode = ${lastUsed + 1})`,
      };
      logger.error(msg);
    } else if (inGradle <= lastUsed) {
      const msg = `versionCode ${inGradle} in android/app/build.gradle was already used (last used: ${lastUsed})`;
      results.android = {
        status: "error",
        version: appConfig.version,
        versionCode: inGradle,
        durationSeconds: 0,
        error: `${msg}. Bump versionCode in android/app/build.gradle (rn-shipyard does not edit tracked native folders)`,
      };
      logger.error(msg);
    } else {
      if (inGradle !== androidVersionCode) {
        logger.warn(
          `android/ is tracked in git: using versionCode ${inGradle} from android/app/build.gradle (not patched; rn-shipyard's computed ${androidVersionCode} is ignored). Manage versionCode there.`
        );
      }
      androidVersionCode = inGradle;
    }
  }

  // Ensure output directory exists
  const outputDir = join(projectDir, config.outputDir);
  await mkdir(outputDir, { recursive: true });

  // Build iOS
  if (doIos && !results.ios) {
    logger.info("Building iOS...");
    const iosConfig = config.platforms.ios!;
    // the lane may raise the build number above TestFlight's latest: it fills in the token
    const outputName = `${safeFileStem(appConfig.name)}-${safeFileStem(appConfig.version)}-${BUILD_NUMBER_TOKEN}.ipa`;

    try {
      const iosBuildResult = await buildIos({
        config: iosConfig,
        outputDir: config.outputDir,
        appName: appConfig.name,
        outputName,
        projectDir,
        buildNumber: iosBuildNumber!,
        buildNumberOverride: iosBuildNumberOverride,
        restoreNativeFiles: prebuild.ios?.action === "skipped_tracked",
        warn: (m) => logger.warn(m),
        info: (m) => logger.info(m),
        json: opts.json,
        interactive,
        profileEnv,
      });
      const usedIosBuildNumber = iosBuildNumberFrom(iosBuildNumber, iosBuildResult.buildNumber);

      results.ios = {
        status: iosBuildResult.status,
        version: appConfig.version,
        buildNumber: usedIosBuildNumber,
        artifactPath: iosBuildResult.artifactPath,
        durationSeconds: iosBuildResult.durationSeconds,
        error: iosBuildResult.error ?? null,
        ...(iosBuildResult.errorCode ? { errorCode: iosBuildResult.errorCode } : {}),
      };

      if (iosBuildResult.status === "success") {
        if (iosBuildResult.testflightLatest !== undefined && iosBuildResult.buildNumber !== iosBuildNumber) {
          logger.info(`iOS build number ${iosBuildResult.buildNumber}: the latest TestFlight build is ${iosBuildResult.testflightLatest}`);
        }
        logger.success(`iOS build succeeded: ${iosBuildResult.artifactPath} (build ${usedIosBuildNumber})`);
      } else {
        logger.error(`iOS build failed${iosBuildResult.errorCode ? ` [${iosBuildResult.errorCode}]` : ""}: ${iosBuildResult.error}`);
      }
    } catch (err) {
      results.ios = {
        status: "error",
        version: appConfig.version,
        buildNumber: iosBuildNumber !== undefined ? String(iosBuildNumber) : undefined,
        durationSeconds: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      logger.error(`iOS build failed: ${results.ios.error}`);
    }
  }

  // Build Android
  if (doAndroid && !results.android) {
    logger.info("Building Android...");
    const androidConfig = config.platforms.android!;
    const outputName = `${safeFileStem(appConfig.name)}-${safeFileStem(appConfig.version)}-${androidVersionCode}.aab`;

    try {
      const androidBuildResult = await buildAndroid({
        config: androidConfig,
        outputDir: config.outputDir,
        outputName,
        projectDir,
        versionCode: androidVersionCode!,
        patchVersionCode: patchAndroidVersionCode,
        json: opts.json,
        interactive,
        profileEnv,
      });

      results.android = {
        status: androidBuildResult.status,
        version: appConfig.version,
        versionCode: androidVersionCode,
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
        versionCode: androidVersionCode,
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
  const submitRequested = opts.submit && !anyFailed;

  if (!opts.json) {
    console.log("");
    logger.info("Build Summary:");
    for (const [platform, result] of Object.entries(results)) {
      if (result.status === "success") {
        logger.success(
          `${platform}: ${result.artifactPath} (${result.durationSeconds}s)`
        );
      } else {
        logger.error(`${platform}${result.errorCode ? ` [${result.errorCode}]` : ""}: ${result.error}`);
      }
    }
  }

  // --submit: submit the builds that just succeeded, with the same profile.
  if (submitRequested) {
    logger.info("Submitting builds...");
    const submitOpts = {
      platform: opts.platform,
      profile: opts.profile,
      json: opts.json,
      nonInteractive: opts.nonInteractive,
      appleLogin,
      // the pre-flight above already ran for the submit actions
      skipChecks: true,
    };
    // runSubmit returns its outcome instead of printing/exiting, so --json can merge it into
    // this command's single document.
    const submitted = await runSubmit(submitOpts);
    if (!opts.json) {
      process.exit(submitted.exitCode);
      return;
    }
    const submitSuccess = (submitted.json as { success?: boolean } | undefined)?.success === true;
    printJson({
      success: allSucceeded && submitSuccess,
      platforms: results,
      prebuild,
      submit: submitted.json ?? {
        success: false,
        error: { code: "SUBMIT_FAILED", message: "submit produced no JSON result", fix: "Run 'rn-shipyard submit' on its own" },
      },
      warnings: logger.warnings,
    });
    process.exit(submitted.exitCode);
    return;
  }

  if (opts.json) {
    printJson({
      success: allSucceeded,
      platforms: results,
      prebuild,
      warnings: logger.warnings,
    });
  }

  process.exit(anyFailed ? 1 : 0);
}

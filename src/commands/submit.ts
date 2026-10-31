import { access } from "node:fs/promises";
import { readConfig, configExists } from "../core/config.js";
import { readHistory, appendHistory, getLastSuccessfulBuild, type PlatformResult } from "../core/history.js";
import { parseEasConfig } from "../core/eas-parser.js";
import { submitIos, checkIosSubmitCredentials, usesAppleIdAuth, appleIdForLogin, ASC_ENV_FIX } from "../platforms/ios/submit.js";
import { appleLogin } from "../platforms/ios/apple-login.js";
import { applyExpoEnvAliases, applyEasSubmitIos } from "../utils/apple-env.js";
import { runPreflight } from "./preflight.js";
import { createPrompter } from "../utils/prompt.js";
import { resolvePath } from "../core/paths.js";
import { submitAndroid } from "../platforms/android/submit.js";
import { createLogger } from "../utils/logger.js";
import { ShipyardError } from "../utils/errors.js";
import { printJson } from "../core/output.js";
import { isInteractive } from "../utils/interactive.js";
import { noPlatformsError } from "./no-platforms.js";

export interface SubmitOptions {
  platform: string;
  json: boolean;
  nonInteractive: boolean;
  profile?: string;
  /** Skip the requirements pre-flight */
  skipChecks?: boolean;
  /** Apple login already done up front (build --submit asks before the build); skips asking again */
  appleLogin?: AppleLoginOutcome;
  /** Print the exact fastlane command and run nothing */
  dryRun?: boolean;
}

/**
 * What a submit run produced: the exit code and, in --json mode, the single JSON document
 * (not printed: `build --submit --json` merges it into its own document).
 */
export interface SubmitOutcome {
  exitCode: number;
  json?: unknown;
}

/**
 * "Log in to your Apple account now? (Y/n)", like EAS. Only closed input (Ctrl-D, EOF) counts as
 * no. Ctrl-C (INTERRUPTED) is rethrown: an aborted run must never go on to upload.
 */
async function confirmAppleLogin(): Promise<boolean> {
  const prompter = createPrompter();
  try {
    const answer = (await prompter.ask("Log in to your Apple account now? (Y/n)")).toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } catch (err) {
    if (err instanceof ShipyardError && err.code === "INPUT_CLOSED") return false;
    throw err;
  } finally {
    prompter.close();
  }
}

/** appleId from eas.json submit.<profile>.ios (also what init writes to the Appfile). */
export async function readIosAppleId(projectDir: string, profile: string): Promise<string | undefined> {
  try {
    const eas = await parseEasConfig(projectDir);
    return (eas.submit?.[profile]?.ios?.appleId as string | undefined) || undefined;
  } catch {
    return undefined;
  }
}

export interface AppleLoginOutcome {
  status: "not-needed" | "declined" | "logged-in" | "lane-missing" | "failed";
  error?: string;
}

/**
 * Phase 1 of an iOS submit: in a terminal, with an Apple ID and no API key, asks to log in and
 * runs the login on the terminal. Throws ShipyardError INTERRUPTED on Ctrl-C. `build --submit`
 * runs it before the build starts and hands the outcome to runSubmit.
 */
export async function appleLoginPhase(o: {
  projectDir: string;
  interactive: boolean;
  appleId?: string;
  warn(message: string): void;
}): Promise<AppleLoginOutcome> {
  if (!o.interactive || !usesAppleIdAuth(o.appleId, process.env)) return { status: "not-needed" };
  const user = appleIdForLogin(o.appleId, process.env) as string;
  if (!(await confirmAppleLogin())) return { status: "declined" };
  const login = await appleLogin({ projectDir: o.projectDir, user });
  if (login.status === "lane-missing") o.warn(login.error ?? "Apple login lane missing");
  return { status: login.status, error: login.error };
}

export default async function submitCmd(opts: SubmitOptions): Promise<void> {
  const outcome = await runSubmit(opts);
  if (outcome.json !== undefined) printJson(outcome.json);
  process.exit(outcome.exitCode);
}

/** Runs submit and returns its outcome instead of printing JSON and exiting. */
export async function runSubmit(opts: SubmitOptions): Promise<SubmitOutcome> {
  const logger = createLogger(opts.json);
  const interactive = isInteractive(opts);
  // EAS-style EXPO_* credential names -> the fastlane names every child reads
  applyExpoEnvAliases();
  /** Ends the run: in --json mode `doc` is returned, otherwise it is already printed by the logger. */
  const done = (exitCode: number, doc?: unknown): SubmitOutcome =>
    opts.json && doc !== undefined ? { exitCode, json: doc } : { exitCode };
  const projectDir = process.cwd();

  // Validate init has been run
  if (!(await configExists(projectDir))) {
    const err = new ShipyardError(
      "MISSING_CONFIG_SHIPYARD",
      "Project not initialized. .shipyard/config.json not found.",
      "Run 'rn-shipyard init' to set up the project first"
    );
    if (!opts.json) {
      logger.error(err.message);
      logger.info(`Fix: ${err.fix}`);
    }
    return done(2, err.toJSON());
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
    const err = noPlatformsError("submit", opts.platform);
    if (!opts.json) {
      logger.error(err.message);
      logger.info(`Fix: ${err.fix}`);
    }
    return done(1, err.toJSON());
  }

  // Requirements pre-flight (the same checks as `doctor`). --dry-run is a check of its own.
  if (!opts.skipChecks && !opts.dryRun) {
    const platforms = [...(doIos ? (["ios"] as const) : []), ...(doAndroid ? (["android"] as const) : [])];
    const preflight = await runPreflight({
      projectDir,
      platforms,
      actions: platforms.map((p) => `submit-${p}` as const),
      json: opts.json,
      nonInteractive: !interactive,
      logger,
    });
    if (!preflight.ok) return { exitCode: preflight.exitCode };
  }

  // Find latest build artifacts (per platform: an android build can be older than an iOS one)
  const profile = opts.profile ?? "production";
  const lastBuild = getLastSuccessfulBuild(history);
  if (!lastBuild) {
    const err = new ShipyardError(
      "NO_ARTIFACTS",
      "No build artifacts found. Run 'rn-shipyard build' first.",
      "Run 'rn-shipyard build' to create build artifacts before submitting"
    );
    if (!opts.json) {
      logger.error(err.message);
      logger.info(`Fix: ${err.fix}`);
    }
    return done(1, err.toJSON());
  }

  // Read eas.json for submit config (track, service account, etc.)
  let easSubmitConfig: { ios?: Record<string, unknown>; android?: Record<string, unknown> } = {};
  try {
    const easConfig = await parseEasConfig(projectDir);
    easSubmitConfig = easConfig.submit?.[profile] ?? {};
  } catch {
    // eas.json may not have submit config, that's OK
  }
  // ascApiKeyPath / ascApiKeyId / ascApiKeyIssuerId / appleTeamId / ascAppId, as eas submit reads them
  applyEasSubmitIos(easSubmitConfig.ios, projectDir);

  const results: {
    ios?: PlatformResult;
    android?: PlatformResult;
  } = {};
  const commands: { ios?: string[]; android?: string[] } = {};
  const artifacts: { ios?: string; android?: string } = {};
  const notEnabled = new Set<string>();
  /** Missing-config problems (exit code 2); other platforms still run */
  let configError: ShipyardError | undefined;

  const fail = (
    platform: "ios" | "android",
    label: string,
    build: PlatformResult | undefined,
    error: string,
    errorCode?: string
  ): void => {
    results[platform] = {
      status: "error",
      version: build?.version ?? "",
      buildNumber: build?.buildNumber,
      versionCode: build?.versionCode,
      durationSeconds: 0,
      error,
      ...(errorCode ? { errorCode } : {}),
    };
    logger.error(`${label}: ${error}`);
  };

  /** Latest successful build for the platform, with its artifact verified on disk. */
  const locateArtifact = async (
    platform: "ios" | "android",
    label: string
  ): Promise<{ build: PlatformResult; path: string } | undefined> => {
    const build = (getLastSuccessfulBuild(history, platform) ?? lastBuild).platforms[platform];
    if (!build || build.status !== "success" || !build.artifactPath) {
      fail(platform, label, build, `No successful ${label} build artifact found`);
      return undefined;
    }
    const path = resolvePath(projectDir, build.artifactPath);
    try {
      await access(path);
    } catch {
      fail(
        platform,
        label,
        build,
        `Build artifact not found at ${build.artifactPath}. Run 'rn-shipyard build' again.`
      );
      return undefined;
    }
    artifacts[platform] = build.artifactPath;
    return { build, path };
  };

  // Requested but not enabled in .shipyard/config.json: report it, never drop it silently
  for (const platform of ["ios", "android"] as const) {
    const requested = opts.platform === "all" || opts.platform === platform;
    const enabled = platform === "ios" ? doIos : doAndroid;
    if (requested && !enabled) {
      const label = platform === "ios" ? "iOS" : "Android";
      notEnabled.add(platform);
      results[platform] = {
        status: "skipped",
        version: "",
        durationSeconds: 0,
        error: `${label} is not enabled in .shipyard/config.json`,
      };
      logger.warn(`${label} skipped: not enabled in .shipyard/config.json`);
    }
  }

  // Submit iOS
  if (doIos) {
    const found = await locateArtifact("ios", "iOS");
    if (found) {
      const { build: iosBuild, path: artifactFullPath } = found;
      const appleId = (easSubmitConfig.ios?.appleId as string | undefined) || undefined;
      // Phase 1 (interactive only): log in to Apple on the user's terminal, so the piped upload
      // that follows reuses the keychain password and the cached session, with no prompt.
      let loginFailure: ShipyardError | undefined;
      if (!opts.dryRun) {
        let login: AppleLoginOutcome;
        try {
          login =
            opts.appleLogin ?? (await appleLoginPhase({ projectDir, interactive, appleId, warn: (m) => logger.warn(m) }));
        } catch (err) {
          if (err instanceof ShipyardError && err.code === "INTERRUPTED") {
            // Ctrl-C at the prompt aborts the whole run: nothing is submitted, no platform after this one either
            logger.error("Interrupted");
            return done(130, err.toJSON());
          }
          throw err;
        }
        if (login.status === "failed") {
          loginFailure = new ShipyardError(
            "APPLE_LOGIN_FAILED",
            login.error ?? "Apple login failed",
            "Check your Apple ID and password, then run submit again; or use an App Store Connect API key (EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID, EXPO_ASC_API_KEY_PATH)"
          );
        }
      }
      // Same check as --dry-run, after the login so a password fastlane just stored counts.
      const credentialProblems = opts.dryRun || loginFailure ? [] : await checkIosSubmitCredentials(appleId, process.env);
      if (loginFailure) {
        fail("ios", "iOS", iosBuild, `${loginFailure.message}. ${loginFailure.fix}`, loginFailure.code);
      } else if (credentialProblems.length > 0) {
        configError = new ShipyardError(
          "MISSING_CONFIG_IOS_CREDENTIALS",
          credentialProblems.join("; "),
          ASC_ENV_FIX
        );
        fail("ios", "iOS", iosBuild, configError.message, configError.code);
      } else {
      if (!opts.dryRun) logger.info(`Submitting iOS: ${iosBuild.artifactPath}`);
      try {
        const submitResult = await submitIos({
          ipaPath: artifactFullPath,
          appleId,
          dryRun: opts.dryRun,
          projectDir,
          json: opts.json,
          interactive,
        });

        results.ios = {
          status: submitResult.status,
          version: iosBuild.version,
          buildNumber: iosBuild.buildNumber,
          durationSeconds: submitResult.durationSeconds,
          error: submitResult.error ?? null,
        };

        if (submitResult.command) {
          commands.ios = submitResult.command;
        } else if (submitResult.status === "success") {
          logger.success(`iOS submitted successfully (${submitResult.durationSeconds}s)`);
        } else {
          logger.error(`iOS submit failed: ${submitResult.error}`);
        }
      } catch (err) {
        fail("ios", "iOS submit failed", iosBuild, err instanceof Error ? err.message : String(err));
      }
      }
    }
  }

  // Submit Android
  if (doAndroid) {
    const found = await locateArtifact("android", "Android");
    if (found) {
      const { build: androidBuild, path: artifactFullPath } = found;
      // Service account: env wins, then eas.json (source of truth for submit settings), then config
      const rawServiceAccount =
        process.env.SUPPLY_JSON_KEY ??
        (easSubmitConfig.android?.serviceAccountKeyPath as string | undefined) ??
        config.platforms.android?.serviceAccountKeyPath;
      const serviceAccountKeyPath = rawServiceAccount
        ? resolvePath(projectDir, rawServiceAccount)
        : undefined;

      const track = (easSubmitConfig.android?.track as string) ?? "internal";
      const releaseStatus = (easSubmitConfig.android?.releaseStatus as string) ?? "draft";

      if (!opts.dryRun) logger.info(`Submitting Android: ${androidBuild.artifactPath}`);
      try {
        const submitResult = await submitAndroid({
          aabPath: artifactFullPath,
          serviceAccountKeyPath,
          track,
          releaseStatus,
          dryRun: opts.dryRun,
          projectDir,
          json: opts.json,
          interactive,
        });

        results.android = {
          status: submitResult.status,
          version: androidBuild.version,
          versionCode: androidBuild.versionCode,
          durationSeconds: submitResult.durationSeconds,
          error: submitResult.error ?? null,
        };

        if (submitResult.command) {
          commands.android = submitResult.command;
        } else if (submitResult.status === "success") {
          logger.success(`Android submitted successfully (${submitResult.durationSeconds}s)`);
        } else if (submitResult.status === "skipped") {
          logger.warn(`Android submit skipped: ${submitResult.error}`);
        } else {
          logger.error(`Android submit failed: ${submitResult.error}`);
        }
      } catch (err) {
        fail(
          "android",
          "Android submit failed",
          androidBuild,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  if (opts.dryRun) {
    // Every requested platform is reported: ok (command printed), skipped (not enabled) or error (problems)
    const report: Record<string, { status: "ok" | "skipped" | "error"; artifactPath: string | null; command: string[] | null; problems: string[] }> = {};
    for (const platform of ["ios", "android"] as const) {
      const r = results[platform];
      if (!r) continue;
      const command = commands[platform];
      const disabled = notEnabled.has(platform);
      report[platform] = {
        status: command ? "ok" : disabled ? "skipped" : "error",
        artifactPath: artifacts[platform] ?? null,
        command: command ?? null,
        problems: command || disabled || !r.error ? [] : [r.error],
      };
    }
    const entries = Object.entries(report);
    const valid = entries.every(([, v]) => v.status !== "error") && entries.some(([, v]) => v.status === "ok");
    if (!opts.json) {
      logger.info(`Dry run, nothing is uploaded and history is untouched. Working directory: ${projectDir}`);
      for (const [platform, v] of entries) {
        if (v.status === "ok" && v.command) {
          logger.success(`${platform}: valid, would run:`);
          console.log(`  ${v.command.map((a) => (/[^\w@%+=:,./-]/.test(a) ? `'${a}'` : a)).join(" ")}`);
        } else if (v.status === "skipped") {
          logger.warn(`${platform}: skipped, not enabled in .shipyard/config.json`);
        } else {
          for (const problem of v.problems) logger.error(`${platform}: ${problem}`);
        }
      }
      if (!valid) logger.error("Dry run found problems, see above");
    }
    return done(valid ? 0 : 1, { success: valid, dryRun: true, cwd: projectDir, platforms: report });
  }

  // Record history
  await appendHistory(projectDir, {
    command: "submit",
    profile,
    platforms: results,
  });

  // Determine overall success: success or skipped = OK, error = fail
  const anyFailed = Object.values(results).some((r) => r.status === "error");

  const onlyConfigFailure =
    !!configError && Object.entries(results).every(([p, r]) => r.status !== "error" || p === "ios");

  if (!opts.json) {
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

  if (configError && !opts.json) logger.info(`Fix: ${configError.fix}`);
  return done(!anyFailed ? 0 : onlyConfigFailure ? 2 : 1, {
    success: !anyFailed,
    platforms: results,
    ...(configError ? { error: { code: configError.code, message: configError.message, fix: configError.fix } } : {}),
  });
}

import { exec } from "../../utils/shell.js";
import { runFastlane, fastlaneArgs } from "../../fastlane/runner.js";
import { hasAscApiKey } from "../../utils/apple-env.js";

/** Env var names accepted for the App Store Connect API key, for messages. */
export const ASC_ENV_FIX =
  "Set EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID and EXPO_ASC_ISSUER_ID (or APP_STORE_CONNECT_API_KEY_KEY_FILEPATH or _KEY, APP_STORE_CONNECT_API_KEY_KEY_ID and APP_STORE_CONNECT_API_KEY_ISSUER_ID), or appleId in eas.json (or EXPO_APPLE_ID / FASTLANE_USER) with EXPO_APPLE_APP_SPECIFIC_PASSWORD (FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD), EXPO_APPLE_PASSWORD (FASTLANE_PASSWORD) or a password stored via 'fastlane fastlane-credentials add'. Run without --non-interactive to log in on your terminal";

/** Apple ID the upload authenticates as: the one fastlane itself resolves (FASTLANE_USER wins over the Appfile). */
export function appleIdForLogin(appleId: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  return env.FASTLANE_USER || appleId || undefined;
}

/** True when submit would authenticate with an Apple ID (a known user and no App Store Connect API key). */
export function usesAppleIdAuth(appleId: string | undefined, env: NodeJS.ProcessEnv): boolean {
  return !hasAscApiKey(env) && !!(appleId || env.FASTLANE_USER);
}

export interface IosSubmitOptions {
  ipaPath: string;
  projectDir: string;
  json: boolean;
  /** Whether the user's terminal was available for the up-front login (phase 1); the upload itself is always piped */
  interactive: boolean;
  /** Validate inputs and return the fastlane command without running it */
  dryRun?: boolean;
  /** Apple ID from eas.json submit.<profile>.ios.appleId (written to the Appfile by init) */
  appleId?: string;
  /** Environment to inspect for credentials (defaults to process.env) */
  env?: NodeJS.ProcessEnv;
}

export interface SubmitResult {
  status: "success" | "error" | "skipped";
  durationSeconds: number;
  error?: string;
  /** Set on dry run: every problem found (error is these joined) */
  problems?: string[];
  /** Set on dry run: the exact command that would be executed */
  command?: string[];
}

/**
 * True when the macOS keychain holds the Apple ID password fastlane stored with
 * `fastlane fastlane-credentials add --username <user>`. fastlane's CredentialsManager::
 * AccountManager reads it without prompting, as an internet password whose server is
 * "deliver.<user>" (account_manager.rb: DEFAULT_PREFIX = "deliver", server_name = "#{prefix}.#{user}").
 * Without -w/-g `security` prints attributes only, never the password. Exit 0 = entry exists.
 */
export async function hasKeychainAppleIdPassword(user: string): Promise<boolean> {
  try {
    const r = await exec("security", ["find-internet-password", "-s", `deliver.${user}`]);
    return r.exitCode === 0;
  } catch {
    return false; // no `security` binary (not macOS) or it could not start
  }
}

/**
 * Inputs `pilot` needs to authenticate without prompting: an App Store Connect API key,
 * or an Apple ID plus a password / app-specific password.
 */
export async function checkIosSubmitCredentials(
  appleId: string | undefined,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  if (hasAscApiKey(env)) return [];

  const user = appleIdForLogin(appleId, env);
  const hasPassword = !!(env.FASTLANE_PASSWORD || env.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD);
  const problems: string[] = [];
  if (!user) {
    problems.push(
      "No App Store Connect credentials: set appleId in eas.json submit.<profile>.ios or EXPO_APPLE_ID / FASTLANE_USER, or an API key (EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID and EXPO_ASC_API_KEY_PATH, or APP_STORE_CONNECT_API_KEY_KEY_ID, _ISSUER_ID and _KEY or _KEY_FILEPATH)"
    );
  } else if (!hasPassword && !(await hasKeychainAppleIdPassword(user))) {
    problems.push(
      `No App Store Connect password for ${user}: set EXPO_APPLE_APP_SPECIFIC_PASSWORD (FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD) or EXPO_APPLE_PASSWORD (FASTLANE_PASSWORD), store it with 'fastlane fastlane-credentials add --username ${user}', or use an App Store Connect API key`
    );
  }
  return problems;
}

export async function submitIos(opts: IosSubmitOptions): Promise<SubmitResult> {
  const options = { ipa_path: opts.ipaPath };

  if (opts.dryRun) {
    const problems = await checkIosSubmitCredentials(opts.appleId, opts.env ?? process.env);
    if (problems.length > 0) {
      return { status: "error", durationSeconds: 0, error: problems.join("; "), problems };
    }
    return {
      status: "skipped",
      durationSeconds: 0,
      command: ["fastlane", ...fastlaneArgs("ios", "submit", options)],
    };
  }

  const result = await runFastlane("ios", "submit", options, {
    json: opts.json,
    projectDir: opts.projectDir,
  });

  if (result.success) {
    return {
      status: "success",
      durationSeconds: result.durationSeconds,
    };
  }

  return {
    status: "error",
    durationSeconds: result.durationSeconds,
    error: result.output.slice(0, 500),
  };
}

import { runFastlane } from "../../fastlane/runner.js";
import type { PlatformIosConfig } from "../../core/config.js";
import { ShipyardError } from "../../utils/errors.js";
import { gitUrlSecrets } from "../../utils/secrets.js";
import { findIosWorkspace } from "./workspace.js";
import { prepareMatchRepo } from "./match-repo.js";

export interface IosBuildOptions {
  config: PlatformIosConfig;
  outputDir: string;
  appName: string;
  outputName: string;
  projectDir: string;
  json: boolean;
  /** Whether the user's terminal may be used for the up-front prompts (match repo clone) */
  interactive: boolean;
  /** eas.json build-profile env, passed to fastlane (never contains rn-shipyard's own secrets) */
  profileEnv?: Record<string, string>;
}

export interface BuildResult {
  status: "success" | "error";
  artifactPath?: string;
  durationSeconds: number;
  error?: string;
  /** Set when the failure has a machine-readable code (e.g. MATCH_REPO_AUTH_FAILED) */
  errorCode?: string;
}

export async function buildIos(opts: IosBuildOptions): Promise<BuildResult> {
  const started = Date.now();
  let target;
  try {
    target = await findIosWorkspace(opts.projectDir);
  } catch (err) {
    if (err instanceof ShipyardError) {
      return {
        status: "error",
        durationSeconds: Math.round((Date.now() - started) / 1000),
        error: `${err.message}. ${err.fix}`,
      };
    }
    throw err;
  }

  // Phase 1: everything that may prompt (git/ssh credentials for the Match repo) runs now, on
  // the user's terminal. Phase 2, the build lane, is fully piped and never prompts.
  let matchRepo;
  try {
    matchRepo = await prepareMatchRepo({
      gitUrl: opts.config.matchGitUrl,
      interactive: opts.interactive,
    });
  } catch (err) {
    if (err instanceof ShipyardError) {
      return {
        status: "error",
        durationSeconds: Math.round((Date.now() - started) / 1000),
        error: `${err.message}. ${err.fix}`,
        errorCode: err.code,
      };
    }
    throw err;
  }
  try {
    return await runIosBuild(opts, target, matchRepo?.env);
  } finally {
    await matchRepo?.dispose();
  }
}

/** Phase 2: the build lane, piped and non-interactive. `matchRepoEnv`: makes git read the Match repo from the local clone. */
async function runIosBuild(
  opts: IosBuildOptions,
  target: { workspace: string; scheme: string },
  matchRepoEnv: Record<string, string> | undefined
): Promise<BuildResult> {
  const result = await runFastlane(
    "ios",
    "build",
    {
      workspace: target.workspace,
      scheme: target.scheme,
      output_dir: opts.outputDir,
      output_name: opts.outputName,
    },
    {
      json: opts.json,
      projectDir: opts.projectDir,
      // profile env first: rn-shipyard's own values win
      // profile env first: rn-shipyard's own values (the git redirect) win
      env: { ...opts.profileEnv, ...matchRepoEnv },
      // a Match repo URL may carry a token (https://<token>@host/...)
      redact: gitUrlSecrets(opts.config.matchGitUrl),
    }
  );

  if (result.success) {
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

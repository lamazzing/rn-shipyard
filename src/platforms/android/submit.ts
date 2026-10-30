import { access } from "node:fs/promises";
import { runFastlane, fastlaneArgs } from "../../fastlane/runner.js";

export interface AndroidSubmitOptions {
  aabPath: string;
  serviceAccountKeyPath?: string;
  track: string;
  releaseStatus?: string;
  /** Validate inputs and return the fastlane command without running it */
  dryRun?: boolean;
  projectDir: string;
  json: boolean;
  /** Whether fastlane may use the terminal */
  interactive: boolean;
}

export interface SubmitResult {
  status: "success" | "error" | "skipped";
  durationSeconds: number;
  error?: string;
  /** Set on dry run: the exact command that would be executed */
  command?: string[];
}

export async function submitAndroid(
  opts: AndroidSubmitOptions
): Promise<SubmitResult> {
  if (!opts.serviceAccountKeyPath) {
    return {
      status: "skipped",
      durationSeconds: 0,
      error:
        "No Google Play service account configured. Add serviceAccountKeyPath to eas.json submit.production.android or set SUPPLY_JSON_KEY env var.",
    };
  }

  try {
    await access(opts.serviceAccountKeyPath);
  } catch {
    return {
      status: "error",
      durationSeconds: 0,
      error: `Google Play service account key not found at ${opts.serviceAccountKeyPath}`,
    };
  }

  const options = {
    aab_path: opts.aabPath,
    track: opts.track,
    release_status: opts.releaseStatus ?? "draft",
    service_account_key: opts.serviceAccountKeyPath,
  };

  if (opts.dryRun) {
    return {
      status: "skipped",
      durationSeconds: 0,
      command: ["fastlane", ...fastlaneArgs("android", "submit", options)],
    };
  }

  const result = await runFastlane(
    "android",
    "submit",
    options,
    {
      json: opts.json,
      projectDir: opts.projectDir,
    }
  );

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

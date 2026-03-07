import { runFastlane } from "../../fastlane/runner.js";

export interface AndroidSubmitOptions {
  aabPath: string;
  serviceAccountKeyPath?: string;
  track: string;
  projectDir: string;
  json: boolean;
}

export interface SubmitResult {
  status: "success" | "error" | "skipped";
  durationSeconds: number;
  error?: string;
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

  const result = await runFastlane(
    "android",
    "submit",
    {
      aab_path: opts.aabPath,
      track: opts.track,
      service_account_key: opts.serviceAccountKeyPath,
    },
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

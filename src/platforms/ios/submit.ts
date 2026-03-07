import { runFastlane } from "../../fastlane/runner.js";

export interface IosSubmitOptions {
  ipaPath: string;
  projectDir: string;
  json: boolean;
}

export interface SubmitResult {
  status: "success" | "error" | "skipped";
  durationSeconds: number;
  error?: string;
}

export async function submitIos(opts: IosSubmitOptions): Promise<SubmitResult> {
  const result = await runFastlane(
    "ios",
    "submit",
    {
      ipa_path: opts.ipaPath,
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

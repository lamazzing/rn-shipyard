import { runFastlane } from "../../fastlane/runner.js";
import type { PlatformIosConfig } from "../../core/config.js";

export interface IosBuildOptions {
  config: PlatformIosConfig;
  outputDir: string;
  appName: string;
  outputName: string;
  projectDir: string;
  json: boolean;
}

export interface BuildResult {
  status: "success" | "error";
  artifactPath?: string;
  durationSeconds: number;
  error?: string;
}

export async function buildIos(opts: IosBuildOptions): Promise<BuildResult> {
  const result = await runFastlane(
    "ios",
    "build",
    {
      output_dir: opts.outputDir,
      output_name: opts.outputName,
    },
    {
      json: opts.json,
      projectDir: opts.projectDir,
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

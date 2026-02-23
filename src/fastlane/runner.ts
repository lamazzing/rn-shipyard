import { exec, type ExecOptions } from "../utils/shell.js";
import { ShipyardError } from "../utils/errors.js";

export interface FastlaneResult {
  success: boolean;
  exitCode: number;
  output: string;
  durationSeconds: number;
}

export async function runFastlane(
  platform: "ios" | "android",
  lane: string,
  options: Record<string, string> = {},
  execOpts: { json?: boolean; projectDir?: string; env?: Record<string, string> } = {}
): Promise<FastlaneResult> {
  const args = [platform, lane];

  // Convert options to fastlane key:value format
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") {
      args.push(`${key}:${value}`);
    }
  }

  const startTime = Date.now();

  try {
    const result = await exec("fastlane", args, {
      cwd: execOpts.projectDir ?? process.cwd(),
      stream: !execOpts.json,
      env: execOpts.env,
    });

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      output: result.stdout + (result.stderr ? "\n" + result.stderr : ""),
      durationSeconds,
    };
  } catch (err) {
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    if (err instanceof Error && err.message.includes("ENOENT")) {
      throw new ShipyardError(
        "FASTLANE_NOT_FOUND",
        "Fastlane is not installed",
        "Install Fastlane: gem install fastlane"
      );
    }

    return {
      success: false,
      exitCode: 1,
      output: err instanceof Error ? err.message : String(err),
      durationSeconds,
    };
  }
}

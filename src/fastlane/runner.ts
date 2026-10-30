import { exec, redactSecrets } from "../utils/shell.js";
import { collectSecrets } from "../utils/secrets.js";
import { ShipyardError } from "../utils/errors.js";

export interface FastlaneResult {
  success: boolean;
  exitCode: number;
  output: string;
  durationSeconds: number;
}

export function fastlaneArgs(
  platform: "ios" | "android",
  lane: string,
  options: Record<string, string | undefined> = {}
): string[] {
  const args: string[] = [platform, lane];
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") args.push(`${key}:${value}`);
  }
  return args;
}

/**
 * Phase 2: fastlane always runs piped (stdin ignored, redacted output, non-interactive env).
 * Anything that needs a prompt happens before, in the foreground (see exec's `foreground`).
 */
export async function runFastlane(
  platform: "ios" | "android",
  lane: string,
  options: Record<string, string> = {},
  execOpts: {
    json?: boolean;
    projectDir?: string;
    env?: Record<string, string>;
    redact?: string[];
  }
): Promise<FastlaneResult> {
  const args = fastlaneArgs(platform, lane, options);

  const startTime = Date.now();

  try {
    const result = await exec("fastlane", args, {
      cwd: execOpts.projectDir ?? process.cwd(),
      stream: !execOpts.json,
      env: execOpts.env,
      redact: execOpts.redact,
      detached: true, // own process group: killed with rn-shipyard on SIGINT/SIGTERM/SIGHUP
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
      output: redactSecrets(
        err instanceof Error ? err.message : String(err),
        collectSecrets({ ...process.env, ...execOpts.env }, execOpts.redact)
      ),
      durationSeconds,
    };
  }
}

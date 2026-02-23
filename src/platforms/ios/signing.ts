import { exec } from "../../utils/shell.js";
import { ShipyardError } from "../../utils/errors.js";

export interface MatchSetupOptions {
  gitUrl: string;
  teamId: string;
  bundleId: string;
  password: string;
  projectDir: string;
  stream: boolean;
}

export async function setupMatch(
  opts: MatchSetupOptions
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await exec(
      "fastlane",
      ["match", "appstore", "--readonly", "false"],
      {
        cwd: opts.projectDir,
        stream: opts.stream,
        env: {
          MATCH_GIT_URL: opts.gitUrl,
          MATCH_PASSWORD: opts.password,
          FASTLANE_TEAM_ID: opts.teamId,
          MATCH_APP_IDENTIFIER: opts.bundleId,
        },
      }
    );

    if (result.exitCode === 0) {
      return { success: true };
    }

    return {
      success: false,
      error: result.stderr || result.stdout || "Match setup failed",
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("ENOENT")) {
      throw new ShipyardError(
        "FASTLANE_NOT_FOUND",
        "Fastlane is not installed",
        "Install Fastlane: gem install fastlane"
      );
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

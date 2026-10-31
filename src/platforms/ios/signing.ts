import { exec } from "../../utils/shell.js";
import { nonInteractiveGitEnv } from "../../utils/git-env.js";
import { resolveSshBase } from "./match-repo.js";
import { ShipyardError } from "../../utils/errors.js";

export interface MatchSetupOptions {
  gitUrl: string;
  teamId: string;
  bundleId: string;
  /** Absent = fastlane reads the passphrase itself (macOS keychain item match_<git url>) */
  password?: string;
  projectDir: string;
  stream: boolean;
  /** Whether match may prompt (Apple ID, 2FA, git credentials): it then runs in the foreground on the terminal. */
  interactive: boolean;
}

export async function setupMatch(
  opts: MatchSetupOptions
): Promise<{ success: boolean; error?: string }> {
  try {
    // Piped (non-interactive) match must not reach the user's terminal: ssh opens /dev/tty for
    // host-key and passphrase prompts regardless of SSH_ASKPASS_REQUIRE. BatchMode forbids those,
    // and a detached child has no controlling terminal at all.
    const gitEnv = opts.interactive ? {} : nonInteractiveGitEnv(await resolveSshBase(), 15);
    const result = await exec(
      "fastlane",
      ["match", "appstore", "--readonly", "false"],
      {
        cwd: opts.projectDir,
        stream: opts.stream,
        // phase 1: on the user's real terminal (Apple ID, 2FA, git/ssh prompts), not piped
        foreground: opts.interactive,
        detached: !opts.interactive,
        env: {
          ...gitEnv,
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

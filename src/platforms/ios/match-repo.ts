import { mkdtemp, rm, chmod } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec, redactSecrets } from "../../utils/shell.js";
import { registerCleanup } from "../../utils/cleanup.js";
import { gitUrlSecrets } from "../../utils/secrets.js";
import { ShipyardError } from "../../utils/errors.js";
import { nonInteractiveGitEnv, gitUrlRedirectEnv, NON_INTERACTIVE_GIT_ARGS, LOW_SPEED_GIT_ARGS } from "../../utils/git-env.js";

export interface MatchRepoClone {
  /** Local bare repository */
  path: string;
  /**
   * Environment for the build lane: git reads the real Match URL from the local clone
   * (url.<path>.insteadOf). Match keeps the real git_url, so its keychain passphrase lookup
   * ("match_" + git_url) still finds the password stored by init.
   */
  env: Record<string, string>;
  /** Removes the temp directory; safe to call more than once */
  dispose(): Promise<void>;
}

/** fastlane's own non-interactive git auth (headers, private key): no prompt can happen, nothing to pre-clone. */
const FASTLANE_GIT_AUTH_ENV = [
  "MATCH_GIT_BASIC_AUTHORIZATION",
  "MATCH_GIT_BEARER_AUTHORIZATION",
  "MATCH_GIT_PRIVATE_KEY",
];

/** The user's own ssh command: GIT_SSH_COMMAND, else git's core.sshCommand, else plain ssh. */
export async function resolveSshBase(env: Record<string, string | undefined> = process.env): Promise<string> {
  if (env.GIT_SSH_COMMAND) return env.GIT_SSH_COMMAND;
  const cfg = await exec("git", ["config", "--get", "core.sshCommand"]).catch(() => undefined);
  return cfg && cfg.exitCode === 0 && cfg.stdout.trim() ? cfg.stdout.trim() : "ssh";
}

/** A URL safe to show: userinfo replaced by ***, query and fragment dropped. Never throws. */
export function safeUrl(url: string): string {
  const strip = (u: string) => u.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1***@").replace(/[?#].*$/, "");
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "";
    }
    u.search = "";
    u.hash = "";
    return u.toString().replace(/%2A%2A%2A/g, "***");
  } catch {
    return strip(url);
  }
}

export const MATCH_REPO_AUTH_FIX =
  "Load your key into ssh-agent (`ssh-add --apple-use-keychain ~/.ssh/id_ed25519`) or configure a git credential helper; or run without --non-interactive to be prompted";

/**
 * Phase 1 of an iOS build: clones the Match repo (bare, every branch) into a private temp dir
 * so that git/ssh may prompt on the user's real terminal (ssh passphrase, https credentials,
 * credential helpers). The build lane then runs fully piped against the local path.
 *
 * Interactive: the clone runs in the foreground. Non-interactive: piped, with
 * GIT_TERMINAL_PROMPT=0 and ssh BatchMode, failing fast with MATCH_REPO_AUTH_FAILED.
 * Returns undefined when there is nothing to do (no URL, or fastlane's own non-prompting git
 * auth is configured). The temp dir is removed by dispose(), by the cleanup machinery on
 * signals, and on process exit.
 */
export async function prepareMatchRepo(opts: {
  gitUrl: string | undefined;
  interactive: boolean;
  env?: Record<string, string | undefined>;
}): Promise<MatchRepoClone | undefined> {
  const env = opts.env ?? process.env;
  if (!opts.gitUrl) return undefined;
  // never let a URL be read as a git option (`--upload-pack=...`)
  if (opts.gitUrl.trim().startsWith("-")) {
    throw new ShipyardError(
      "INVALID_MATCH_GIT_URL",
      "The Match git URL must not start with '-'",
      "Set matchGitUrl in .shipyard/config.json (and the Matchfile) to a real git URL, e.g. git@github.com:you/certs.git"
    );
  }
  if (FASTLANE_GIT_AUTH_ENV.some((name) => env[name])) return undefined;

  const root = await mkdtemp(join(tmpdir(), "shipyard-match-"));
  await chmod(root, 0o700);
  const path = join(root, "repo.git");
  const handle = registerCleanup(
    () => rm(root, { recursive: true, force: true }),
    () => rmSync(root, { recursive: true, force: true })
  );
  const dispose = async () => {
    await handle.run();
    handle.unregister();
  };

  try {
    const clone = ["clone", "--bare", "--", opts.gitUrl, path];
    const secrets = gitUrlSecrets(opts.gitUrl);
    let result;
    if (opts.interactive) {
      // the user's normal git behaviour: prompts, askpass programs, credential helpers
      result = await exec("git", clone, { foreground: true });
    } else {
      // Nothing may prompt or pop a GUI dialog: not the terminal, not askpass programs, not
      // credential helpers such as Git Credential Manager.
      const sshBase = await resolveSshBase(env);
      result = await exec("git", [...NON_INTERACTIVE_GIT_ARGS, ...LOW_SPEED_GIT_ARGS, ...clone], {
        redact: secrets,
        // own session: no controlling terminal, so ssh cannot open /dev/tty either
        detached: true,
        env: nonInteractiveGitEnv(sshBase, 15),
      });
    }
    if (result.exitCode !== 0) {
      const detail = opts.interactive
        ? "see the git output above"
        : redactSecrets(result.stderr || result.stdout, secrets).split("\n").slice(-4).join(" ").slice(0, 300);
      throw new ShipyardError(
        "MATCH_REPO_AUTH_FAILED",
        `Could not clone the Match repository ${safeUrl(opts.gitUrl)} (git exit ${result.exitCode}${detail ? `: ${detail}` : ""})`,
        MATCH_REPO_AUTH_FIX
      );
    }
  } catch (err) {
    await dispose();
    if (err instanceof ShipyardError) throw err;
    throw new ShipyardError(
      "MATCH_REPO_AUTH_FAILED",
      `Could not clone the Match repository ${safeUrl(opts.gitUrl)}: ${redactSecrets(err instanceof Error ? err.message : String(err), gitUrlSecrets(opts.gitUrl))}`,
      MATCH_REPO_AUTH_FIX
    );
  }
  return { path, env: gitUrlRedirectEnv(path, opts.gitUrl, env), dispose };
}

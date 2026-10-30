/**
 * Environment and arguments that make a git command fail instead of asking the user: no
 * terminal prompt, no askpass helper or credential-manager dialog, no ssh password prompt.
 */
export const NON_INTERACTIVE_GIT_ARGS = ["-c", "credential.interactive=never", "-c", "core.askPass=true"];

/** Aborts an https transfer that stalls (under 1 kB/s for 60 s) instead of hanging forever. */
export const LOW_SPEED_GIT_ARGS = ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=60"];

/** `baseSshCommand` is the user's ssh command (GIT_SSH_COMMAND, core.sshCommand or "ssh"); it is kept. */
export function nonInteractiveGitEnv(baseSshCommand: string, connectTimeoutSeconds = 8): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "true",
    SSH_ASKPASS: "true",
    SSH_ASKPASS_REQUIRE: "never",
    GCM_INTERACTIVE: "never",
    GIT_SSH_COMMAND: `${baseSshCommand || "ssh"} -o BatchMode=yes -o ConnectTimeout=${connectTimeoutSeconds}`,
  };
}

/**
 * Env-only git config that makes git read `realUrl` from the local repository at `localPath`
 * (`url.<localPath>.insteadOf = <realUrl>`), via GIT_CONFIG_COUNT / _KEY_n / _VALUE_n (git 2.31+).
 * Pairs already in `env` are kept: the new one is appended after them. Values travel in the
 * environment only: nothing is put on a command line or shell-interpolated, so paths with spaces work.
 */
export function gitUrlRedirectEnv(
  localPath: string,
  realUrl: string,
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const n = Number.parseInt(env.GIT_CONFIG_COUNT ?? "", 10);
  const first = Number.isInteger(n) && n > 0 ? n : 0;
  return {
    GIT_CONFIG_COUNT: String(first + 1),
    [`GIT_CONFIG_KEY_${first}`]: `url.${localPath}.insteadOf`,
    [`GIT_CONFIG_VALUE_${first}`]: realUrl,
  };
}

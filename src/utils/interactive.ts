/**
 * Policy: rn-shipyard prompts, and lets child processes use the terminal, only when stdin AND
 * stdout are a TTY and neither --json, --non-interactive nor CI is set. Anything else (pipes, CI,
 * </dev/null) behaves as --non-interactive: values come from the environment and Expo config,
 * a missing value is an error, and children get no stdin so a prompting tool fails fast.
 * Computed once per command and threaded down to every exec()/runFastlane() call.
 */
export function isInteractive(opts: { json?: boolean; nonInteractive?: boolean }): boolean {
  return (
    !opts.json &&
    !opts.nonInteractive &&
    !isCi() &&
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY)
  );
}

/** CI is set (truthy, not "0"/"false"), as EAS CLI treats it: CI runners with a pty must not prompt. */
function isCi(): boolean {
  const v = process.env.CI;
  return !!v && v !== "0" && v.toLowerCase() !== "false";
}

import { killActiveChildren, signalActiveChildrenSync, restoreSavedTerminalState, redactSecrets } from "./shell.js";
import { runCleanups, runSyncCleanups } from "./cleanup.js";
import { installStreamGuards, safeWrite, writeStdoutSync } from "./terminal.js";
import { collectSecrets } from "./secrets.js";

export const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
} as const;

export type HandledSignal = keyof typeof SIGNAL_EXIT_CODES;

/**
 * The real process.exit, captured at load time: nothing (a test, a capture helper) that later
 * replaces process.exit can make the signal handler throw instead of exit.
 */
const realExit: (code: number) => void = process.exit.bind(process) as (code: number) => void;

export interface SignalDeps {
  exit?: (code: number) => void;
  /** Writes the human notice (stderr). Never throws. */
  write?: (text: string) => void;
  /** Writes the --json envelope to stdout. Never throws. */
  writeJson?: (text: string) => void;
  /** True in --json mode: an INTERRUPTED envelope is printed before exiting. */
  json?: boolean;
  graceMs?: number;
}

let handling = false;

/** Test helper. */
export function resetSignalStateForTests(): void {
  handling = false;
  crashing = false;
}

export function interruptedEnvelope(signal: string): string {
  return (
    JSON.stringify({
      success: false,
      error: {
        code: "INTERRUPTED",
        message: `Interrupted by ${signal}`,
        fix: "Run the command again; package.json and lockfiles were restored",
      },
    }) + "\n"
  );
}

/**
 * Order matters: first stop every child (whole process group, SIGTERM then SIGKILL) and
 * wait until it is gone, THEN restore files. Restoring while the child still runs lets it
 * rewrite package.json afterwards. The notice goes to stderr so --json stdout stays clean.
 * Writing to a dead terminal (closed window: EIO, closed pipe: EPIPE) never aborts cleanup.
 */
export async function handleSignal(signal: HandledSignal, deps: SignalDeps = {}): Promise<void> {
  const exit = deps.exit ?? realExit;
  const write = deps.write ?? ((text: string) => void safeWrite(process.stderr, text));
  const writeJson = deps.writeJson ?? ((text: string) => void writeStdoutSync(text));
  if (handling) return; // a second signal while cleaning up is ignored
  handling = true;
  try {
    write("\nInterrupted. Cleaning up...\n");
  } catch {
    // dead terminal
  }
  try {
    await killActiveChildren(deps.graceMs);
    restoreSavedTerminalState(); // echo left off by a killed password read
    await runCleanups();
  } catch {
    // best effort: still exit with the signal's code
  } finally {
    if (deps.json) {
      try {
        writeJson(interruptedEnvelope(signal));
      } catch {
        // dead stdout
      }
    }
    exit(SIGNAL_EXIT_CODES[signal]);
  }
}

let crashing = false;

/**
 * An uncaught exception or unhandled rejection: stop children, restore files, exit 1.
 * Never throws, whatever state the streams are in.
 */
export async function handleCrash(err: unknown, deps: SignalDeps = {}): Promise<void> {
  const exit = deps.exit ?? realExit;
  const write = deps.write ?? ((text: string) => void safeWrite(process.stderr, text));
  const writeJson = deps.writeJson ?? ((text: string) => void writeStdoutSync(text));
  if (crashing || handling) return;
  crashing = true;
  let message = err instanceof Error ? err.message : String(err);
  try {
    message = redactSecrets(message, collectSecrets(process.env as Record<string, string | undefined>));
  } catch {
    // keep the raw message
  }
  try {
    write(`\nUnexpected error: ${message}\n`);
  } catch {
    // dead terminal
  }
  try {
    await killActiveChildren(deps.graceMs ?? 1500);
    await runCleanups();
  } catch {
    // best effort
  } finally {
    if (deps.json) {
      try {
        writeJson(
          JSON.stringify({
            success: false,
            error: {
              code: "UNEXPECTED_ERROR",
              message,
              fix: "Run the command again; if it persists, open an issue with the message above",
            },
          }) + "\n"
        );
      } catch {
        // dead stdout
      }
    }
    exit(1);
  }
}

/** Installs SIGINT/SIGTERM/SIGHUP handlers; returns a function that removes them. */
export function installSignalHandlers(deps: SignalDeps = {}): () => void {
  const listeners = new Map<HandledSignal, () => void>();
  for (const signal of Object.keys(SIGNAL_EXIT_CODES) as HandledSignal[]) {
    const fn = () => void handleSignal(signal, deps);
    listeners.set(signal, fn);
    process.on(signal, fn);
  }
  return () => {
    for (const [signal, fn] of listeners) process.off(signal, fn);
  };
}

/**
 * Everything the CLI entry point installs: error handlers on stdout/stderr (a dead pipe or
 * terminal must not kill the process), SIGINT/SIGTERM/SIGHUP handling, crash handlers, and a
 * synchronous last-resort restore on 'exit' (the async restore stays the primary path).
 */
export function installProcessGuards(deps: SignalDeps = {}): () => void {
  installStreamGuards();
  const removeSignals = installSignalHandlers(deps);
  const onCrash = (err: unknown) => void handleCrash(err, deps);
  const onExit = () => {
    signalActiveChildrenSync("SIGTERM");
    runSyncCleanups();
  };
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);
  process.on("exit", onExit);
  return () => {
    removeSignals();
    process.off("uncaughtException", onCrash);
    process.off("unhandledRejection", onCrash);
    process.off("exit", onExit);
  };
}

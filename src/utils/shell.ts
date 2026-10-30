import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { collectSecrets, isPemBoundary } from "./secrets.js";
import { safeWrite } from "./terminal.js";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  stream?: boolean;
  /** Extra secret values (on top of the known secret env vars, which are always
   *  collected from the merged env) replaced by *** in streamed and captured output. */
  redact?: string[];
  /**
   * Run the child in its own process group (session) so the whole tree can be signalled
   * on SIGINT/SIGTERM/SIGHUP (see killActiveChildren). Use for long-running tools
   * (expo prebuild, fastlane). A terminal Ctrl-C then reaches only rn-shipyard, which
   * forwards it, so the child is never interrupted twice.
   */
  detached?: boolean;
  /**
   * Phase-1 mode: the child gets the user's real terminal. stdin/stdout/stderr are fully
   * inherited, it is NOT detached (it stays in our process group, so it has the controlling
   * TTY and a terminal Ctrl-C reaches it), and nothing is captured or redacted: this is the
   * user's own terminal (ssh passphrase, git credentials, Apple ID password, 2FA code). The
   * environment is left untouched. Every registered stdin releaser runs first, so no readline
   * prompter still holds the terminal. The child is still tracked, so signal handling stops it
   * and then restores files. The result's stdout/stderr are empty.
   *
   * Only for callers that checked isInteractive(): exec() throws when stdin or stdout is not a
   * TTY, rather than hanging or silently piping. Without `foreground` a child is always piped:
   * stdin ignored and NON_INTERACTIVE_ENV set, so a prompting tool fails fast instead of hanging.
   */
  foreground?: boolean;
}

/** Environment that makes fastlane/spaceship/expo fail instead of prompt. */
export const NON_INTERACTIVE_ENV: Record<string, string> = {
  CI: "1",
  FASTLANE_IS_INTERACTIVE: "false",
  SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA: "true",
  // A piped child has no stdin, but git/ssh can still open /dev/tty or an askpass/credential
  // dialog (e.g. init's piped `fastlane match` clone): make them fail instead of prompting.
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "true",
  SSH_ASKPASS: "true",
  SSH_ASKPASS_REQUIRE: "never",
  GCM_INTERACTIVE: "never",
};

const stdinReleasers = new Set<() => void>();

/**
 * Registers something that holds the terminal's stdin (a readline prompter). exec() calls it
 * right before spawning any child that inherits stdin, so a child never competes with it.
 * Returns an unregister function.
 */
export function registerStdinReleaser(fn: () => void): () => void {
  stdinReleasers.add(fn);
  return () => {
    stdinReleasers.delete(fn);
  };
}

function releaseStdin(): void {
  for (const fn of [...stdinReleasers]) {
    try {
      fn();
    } catch {
      // best effort
    }
  }
}

interface ActiveChild {
  child: ChildProcess;
  detached: boolean;
  exited: boolean;
}

const active = new Set<ActiveChild>();
let shuttingDown = false;

/** True once killActiveChildren has run: no further child is started or reported. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Test helper: undo the shutdown latch. */
export function resetShutdownForTests(): void {
  shuttingDown = false;
}

function signalChild(entry: ActiveChild, signal: NodeJS.Signals): void {
  const pid = entry.child.pid;
  if (pid === undefined) return;
  try {
    // negative pid = the whole process group (the child is its leader)
    process.kill(entry.detached ? -pid : pid, signal);
  } catch {
    // already gone
  }
}

function groupAlive(entry: ActiveChild): boolean {
  const pid = entry.child.pid;
  if (pid === undefined) return false;
  try {
    process.kill(entry.detached ? -pid : pid, 0);
    return true;
  } catch {
    return false;
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitGone(entries: ActiveChild[], ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (entries.every((e) => e.exited && !groupAlive(e))) return true;
    if (Date.now() >= deadline) return false;
    await delay(25);
  }
}

/**
 * Stops every running child (and, for detached ones, its whole process group): SIGTERM,
 * then SIGKILL after `graceMs`. Resolves once they are gone, so callers can safely restore
 * files afterwards. Afterwards exec() never resolves again: the process is about to exit
 * and must not continue its build flow.
 */
export async function killActiveChildren(graceMs = 3000): Promise<void> {
  shuttingDown = true;
  const entries = [...active];
  if (entries.length === 0) return;
  for (const e of entries) signalChild(e, "SIGTERM");
  if (await waitGone(entries, graceMs)) return;
  for (const e of entries) signalChild(e, "SIGKILL");
  await waitGone(entries, 2000);
}

/** Synchronous SIGTERM to every running child (process.on('exit'): detached children would outlive us). */
export function signalActiveChildrenSync(signal: NodeJS.Signals = "SIGTERM"): void {
  for (const e of active) signalChild(e, signal);
  restoreSavedTerminalState();
}

/** Ruby Shellwords.escape, which fastlane uses when it prints commands. */
function shellEscape(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-.,:+/@\n]/gu, "\\$&").replace(/\n/g, "'\n'");
}

/** Ruby String#inspect body: backslashes, quotes, and `#{` `#$` `#@` escaped as `\#...`. */
function rubyInspectBody(s: string): string {
  return s.replace(/[\\"]/g, "\\$&").replace(/#(?=[{$@])/g, "\\#");
}

/** Every textual form a single-line secret may take in tool output. */
function formsOf(s: string): string[] {
  return [
    s,
    shellEscape(s),
    `'${s.replace(/'/g, "'\\''")}'`,
    `"${s.replace(/[\\"$`]/g, "\\$&")}"`,
    JSON.stringify(s).slice(1, -1),
    rubyInspectBody(s),
    safeEncodeURIComponent(s),
  ];
}

/** encodeURIComponent throws on a lone surrogate: such a secret simply has no URL form. */
function safeEncodeURIComponent(s: string): string {
  try {
    return encodeURIComponent(s);
  } catch {
    return "";
  }
}

/** Every textual form a secret may take in tool output, longest first. */
export function secretVariants(secrets: string[] = []): string[] {
  const out = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    // a multi-line secret is matched per line, since output is redacted line by line
    for (const line of secret.split(/\r\n|\n|\r/)) {
      if (!line || isPemBoundary(line)) continue;
      // Unicode: the tool may print the composed or the decomposed form
      for (const base of new Set([line, line.normalize("NFC"), line.normalize("NFD")])) {
        for (const f of formsOf(base)) if (f) out.add(f);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Finds every occurrence of every variant first, merges overlapping and adjacent
 * ranges, then masks each merged range once. Replacing variant by variant would
 * leave a fragment (`***ef`) when two secrets overlap.
 */
function applyVariants(text: string, variants: string[], skip = 0): string {
  const ranges: Array<[number, number]> = [];
  for (const v of variants) {
    if (!v) continue;
    let i = text.indexOf(v);
    while (i !== -1) {
      ranges.push([i, i + v.length]);
      i = text.indexOf(v, i + 1);
    }
  }
  if (ranges.length === 0) return text.slice(skip);
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) {
      if (b > last[1]) last[1] = b;
    } else {
      merged.push([a, b]);
    }
  }
  let out = "";
  let pos = skip;
  for (const [a, b] of merged) {
    if (b <= skip) continue; // entirely inside text whose mask was already emitted
    if (a > pos) out += text.slice(pos, a);
    // a range that began inside the first `skip` chars continues an already emitted ***
    if (a >= skip) out += "***";
    pos = b;
  }
  return out + text.slice(pos);
}

/**
 * Replaces every non-empty secret (raw, shell-escaped, quoted, URL-encoded, Ruby-inspected
 * and Unicode-normalised forms) with ***. There is no minimum length: a 1-char secret
 * garbles output but never leaks.
 */
export function redactSecrets(text: string, secrets: string[] = []): string {
  return applyVariants(text, secretVariants(secrets));
}

export interface StreamRedactor {
  /** Feed a chunk; returns the redacted text that is safe to emit now. */
  push(chunk: Buffer | string): string;
  /** True while a possibly unfinished secret is held back. */
  hasHeld(): boolean;
  /** Releases the held-back text on idle timeout (masked when it is 3+ chars of a secret prefix). */
  drainHeld(): string;
  /** End of stream; returns the redacted remainder. */
  flush(): string;
}

/** Length of the longest suffix of `text` that is a proper prefix of some variant. */
function heldSuffixLength(text: string, variants: string[]): number {
  let best = 0;
  for (const v of variants) {
    const max = Math.min(v.length - 1, text.length);
    for (let k = max; k > best; k--) {
      if (text.charCodeAt(text.length - k) === v.charCodeAt(0) && text.endsWith(v.slice(0, k))) {
        best = k;
        break;
      }
    }
  }
  return best;
}

/**
 * Streaming redaction. Everything is emitted immediately (so a prompt without a trailing
 * newline, like "Please enter the 6 digit code: ", shows up) EXCEPT the longest suffix of the
 * pending text that could still grow into a secret, i.e. is a proper prefix of some variant.
 * That suffix is held until the next chunk completes or refutes it; exec() releases it after a
 * short idle time (drainHeld) so a lingering partial match cannot swallow output forever.
 */
export function createStreamRedactor(secrets: string[] = []): StreamRedactor {
  const variants = secretVariants(secrets);
  const decoder = new StringDecoder("utf8");
  const maxCarry = Math.max(0, ...variants.map((v) => v.length)) - 1;
  // Pending text. Its first `skip` chars were drained as an already emitted *** (the carry):
  // they are kept only so a continuation arriving later is still recognised as the rest of
  // that secret and masked, instead of leaking its tail.
  let tail = "";
  let skip = 0;

  const redactor: StreamRedactor = {
    push(chunk) {
      const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
      if (variants.length === 0) return text;
      tail += text;
      let cut = tail.length - heldSuffixLength(tail, variants);
      // never cut through a complete secret that straddles the boundary; moving `cut` back can
      // make an earlier match straddle it, so repeat until it stops moving
      let moved = true;
      while (moved) {
        moved = false;
        for (const v of variants) {
          let i = tail.indexOf(v);
          while (i !== -1) {
            if (i < cut && i + v.length > cut) {
              cut = i;
              moved = true;
            }
            i = tail.indexOf(v, i + 1);
          }
        }
      }
      const emit = applyVariants(tail.slice(0, cut), variants, skip);
      tail = tail.slice(cut);
      skip = Math.max(0, skip - cut);
      return emit;
    },
    hasHeld() {
      return tail.length > skip;
    },
    drainHeld() {
      if (tail.length <= skip) return "";
      // Mask whatever is held, of any length, and keep it as carry context. Releasing a short
      // prefix would leak it for good: after the pause the continuation no longer matches.
      const out = skip > 0 ? "" : "***";
      if (tail.length > maxCarry) tail = tail.slice(tail.length - maxCarry);
      skip = tail.length;
      return out;
    },
    flush() {
      const rest = decoder.end();
      if (variants.length === 0) return rest;
      let out = rest ? redactor.push(rest) : "";
      // whatever is still held is an unfinished secret prefix (the process stopped mid-secret):
      // mask it, unless it only continues a carry whose *** is already out
      if (tail.length > skip && skip === 0) out += "***";
      tail = "";
      skip = 0;
      return out;
    },
  };
  return redactor;
}

/** How long a possible partial secret may be held back without being completed. */
export const REDACTOR_IDLE_MS = 150;

/** Terminal settings (`stty -g`) to put back after a foreground child, e.g. echo it switched off for a password. */
let savedTerminalState: string | undefined;

/**
 * Puts the terminal back as it was before the running foreground child (echo may be off after a
 * password read that was killed). Idempotent; also called by the signal handler and the exit hook.
 */
export function restoreSavedTerminalState(): void {
  const state = savedTerminalState;
  if (!state) return;
  restoreTerminalState(state);
  savedTerminalState = undefined;
}

function saveTerminalState(): string | undefined {
  try {
    // timeout: a backgrounded job gets SIGTTOU from the tty and stty would stop forever
    const r = spawnSync("stty", ["-g"], { stdio: ["inherit", "pipe", "ignore"], encoding: "utf8", timeout: 2000 });
    const state = typeof r.stdout === "string" ? r.stdout.trim() : "";
    return r.status === 0 && state ? state : undefined;
  } catch {
    return undefined;
  }
}

function restoreTerminalState(state: string | undefined): void {
  if (!state) return;
  try {
    spawnSync("stty", [state], { stdio: ["inherit", "ignore", "ignore"], timeout: 2000 });
  } catch {
    // best effort
  }
}

/** Phase-1 child on the user's real terminal (see ExecOptions.foreground). */
function execForeground(cmd: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `exec(${cmd}, { foreground: true }) needs a terminal: check isInteractive() before asking for a foreground child`
    );
  }
  // A readline prompter still holding stdin would eat the child's keystrokes.
  releaseStdin();
  const ttyState = saveTerminalState();
  if (ttyState) savedTerminalState = ttyState;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: "inherit",
      timeout: opts.timeout,
    });
    const entry: ActiveChild = { child, detached: false, exited: false };
    active.add(entry);
    child.on("exit", () => {
      entry.exited = true;
    });
    child.on("error", (err) => {
      entry.exited = true;
      active.delete(entry);
      restoreTerminalState(ttyState);
      if (savedTerminalState === ttyState) savedTerminalState = undefined;
      reject(err);
    });
    child.on("close", (code) => {
      entry.exited = true;
      active.delete(entry);
      // also when a signal killed the child mid-prompt (echo off during a password read)
      restoreTerminalState(ttyState);
      if (savedTerminalState === ttyState) savedTerminalState = undefined;
      if (shuttingDown) return; // the signal handler owns the rest of the run
      resolve({ exitCode: code ?? 1, stdout: "", stderr: "" });
    });
  });
}

export async function exec(
  cmd: string,
  args: string[],
  opts: ExecOptions = {}
): Promise<ExecResult> {
  // After a termination signal nothing new may start and nothing may resume.
  if (shuttingDown) return new Promise<ExecResult>(() => {});
  if (opts.foreground) return execForeground(cmd, args, opts);
  const env = { ...process.env, ...NON_INTERACTIVE_ENV, ...opts.env };
  // Env secrets are redacted by default, whatever the call site passes in `redact`.
  const secrets = collectSecrets(env, opts.redact);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeout,
      detached: opts.detached === true,
    });
    const entry: ActiveChild = { child, detached: opts.detached === true, exited: false };
    active.add(entry);
    child.on("exit", () => {
      entry.exited = true;
    });

    let stdout = "";
    let stderr = "";
    const outRedactor = createStreamRedactor(secrets);
    const errRedactor = createStreamRedactor(secrets);

    const emitOut = (text: string) => {
      if (!text) return;
      stdout += text;
      if (opts.stream) safeWrite(process.stdout, text);
    };
    const emitErr = (text: string) => {
      if (!text) return;
      stderr += text;
      if (opts.stream) safeWrite(process.stderr, text);
    };

    const timers = new Set<NodeJS.Timeout>();
    const pump = (
      redactor: StreamRedactor,
      emit: (text: string) => void,
      idle: { t?: NodeJS.Timeout }
    ) => (data: Buffer) => {
      if (idle.t) clearTimeout(idle.t);
      emit(redactor.push(data));
      if (redactor.hasHeld()) {
        idle.t = setTimeout(() => {
          timers.delete(idle.t as NodeJS.Timeout);
          emit(redactor.drainHeld());
        }, REDACTOR_IDLE_MS);
        timers.add(idle.t);
      }
    };
    const outIdle: { t?: NodeJS.Timeout } = {};
    const errIdle: { t?: NodeJS.Timeout } = {};
    child.stdout?.on("data", pump(outRedactor, emitOut, outIdle));
    child.stderr?.on("data", pump(errRedactor, emitErr, errIdle));

    child.on("error", (err) => {
      for (const t of timers) clearTimeout(t);
      entry.exited = true;
      active.delete(entry);
      reject(err);
    });

    child.on("close", (code) => {
      for (const t of timers) clearTimeout(t);
      entry.exited = true;
      active.delete(entry);
      if (shuttingDown) return; // the signal handler owns the rest of the run
      emitOut(outRedactor.flush());
      emitErr(errRedactor.flush());
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await exec("which", [cmd]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

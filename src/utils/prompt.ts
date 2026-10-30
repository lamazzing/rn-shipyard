import { createInterface, type Interface } from "node:readline";
import { Writable } from "node:stream";
import { ShipyardError } from "./errors.js";

export interface PrompterOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Force terminal (echo) handling; defaults to input.isTTY */
  terminal?: boolean;
}

export interface Prompter {
  /** Plain question. The default is shown in brackets and returned on empty input. */
  ask(question: string, defaultValue?: string): Promise<string>;
  /**
   * Secret question: typed characters are never echoed. A fallback (e.g. an env
   * value) is never displayed; "[from env]" is shown instead and Enter accepts it.
   */
  askSecret(question: string, fallback?: string): Promise<string>;
  close(): void;
}

function closedError(): ShipyardError {
  return new ShipyardError(
    "INPUT_CLOSED",
    "Input ended before all questions were answered",
    "Run init in a terminal, or pass --non-interactive and provide values via environment variables"
  );
}

function interruptedError(): ShipyardError {
  return new ShipyardError("INTERRUPTED", "Interrupted", "Run the command again");
}

/**
 * One readline interface shared by every prompt (a new interface per question
 * would swallow buffered stdin). Output goes through a muting stream so secret
 * answers are not echoed; the terminal state is restored by close().
 */
export function createPrompter(opts: PrompterOptions = {}): Prompter {
  const input = opts.input ?? process.stdin;
  const realOut = opts.output ?? process.stdout;
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) realOut.write(chunk);
      cb();
    },
  });

  const terminal = opts.terminal ?? Boolean((input as { isTTY?: boolean }).isTTY);
  const rl: Interface = createInterface({
    input,
    output: out,
    terminal,
    // typed secrets must not be recallable with the arrow keys
    historySize: 0,
  });

  let closed = false;
  let pending: ((err: ShipyardError) => void) | undefined;
  let waiter: ((line: string) => void) | undefined;
  const buffered: string[] = []; // lines that arrived while no question was pending

  rl.on("line", (line) => {
    if (waiter) {
      const w = waiter;
      waiter = undefined;
      w(line);
    } else buffered.push(line);
  });
  rl.on("close", () => {
    closed = true;
    muted = false;
    pending?.(closedError());
  });
  rl.on("SIGINT", () => {
    const fail = pending;
    muted = false;
    fail?.(interruptedError());
    rl.close();
  });

  function question(text: string, secret: boolean): Promise<string> {
    realOut.write(text);
    if (buffered.length > 0) {
      if (secret) realOut.write("\n");
      return Promise.resolve(buffered.shift() as string);
    }
    if (closed) return Promise.reject(closedError());
    return new Promise<string>((resolve, reject) => {
      pending = (err) => {
        pending = undefined;
        waiter = undefined;
        if (secret) realOut.write("\n");
        reject(err);
      };
      muted = secret; // the prompt text is written directly; readline's own echo is swallowed
      waiter = (line) => {
        pending = undefined;
        muted = false;
        if (secret) realOut.write("\n");
        resolve(line);
      };
    });
  }

  return {
    async ask(q, defaultValue) {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = await question(`  ${q}${suffix}: `, false);
      return answer.trim() || defaultValue || "";
    },
    async askSecret(q, fallback) {
      const suffix = fallback ? " [from env]" : "";
      const answer = await question(`  ${q}${suffix}: `, true);
      return answer.length > 0 ? answer : fallback ?? "";
    },
    close() {
      muted = false;
      if (!closed) rl.close();
    },
  };
}

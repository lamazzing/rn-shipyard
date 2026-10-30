import { writeSync } from "node:fs";

/** Streams whose write failed (EPIPE: closed pipe, EIO: closed terminal, ...). */
const dead = new WeakSet<object>();
const guarded = new WeakSet<object>();

type Stream = NodeJS.WriteStream | NodeJS.WritableStream;

/**
 * Attaches an `error` handler that swallows every write error and marks the stream dead.
 * Without it, `rn-shipyard build | head -2` (EPIPE) or closing the terminal window (EIO)
 * raises an unhandled 'error' event, the process dies, and cleanup never runs.
 */
export function guardStream(stream: Stream): void {
  if (guarded.has(stream)) return;
  guarded.add(stream);
  (stream as NodeJS.EventEmitter).on("error", () => {
    dead.add(stream);
  });
}

/** Installed once at startup (see installProcessGuards). */
export function installStreamGuards(): void {
  guardStream(process.stdout);
  guardStream(process.stderr);
}

export function isStreamDead(stream: Stream): boolean {
  return dead.has(stream) || (stream as { destroyed?: boolean }).destroyed === true;
}

/** Writes to a stream and never throws; a stream that failed once is not written to again. */
export function safeWrite(stream: Stream, text: string): boolean {
  guardStream(stream);
  if (isStreamDead(stream)) return false;
  try {
    stream.write(text);
    return true;
  } catch {
    dead.add(stream);
    return false;
  }
}

/** Test helper. */
export function markAlive(stream: Stream): void {
  dead.delete(stream);
}

type WriteFn = (fd: number, buf: Buffer, offset: number, length: number) => number;

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
/** Blocks the thread for `ms` (a pipe reader is slow; there is no async to yield to here). */
function sleepSync(ms: number): void {
  Atomics.wait(sleepCell, 0, 0, ms);
}

/** Consecutive 0-byte writes (no error, no progress) tolerated before giving up. */
const MAX_ZERO_WRITES = 50;
/** Longest a full pipe may stay full before the write is abandoned. */
const MAX_BLOCKED_MS = 60_000;

/**
 * Writes all of `text` to `fd` synchronously. Handles partial writes, retries EAGAIN (a
 * non-blocking pipe whose reader has not caught up) and gives up silently on EPIPE or any
 * other error. Returns whether everything was written. Never throws.
 */
export function writeFdSync(fd: number, text: string, write: WriteFn = writeSync as WriteFn): boolean {
  const buf = Buffer.from(text, "utf8");
  let off = 0;
  let blocked = 0;
  let zeroWrites = 0;
  while (off < buf.length) {
    try {
      const n = write(fd, buf, off, buf.length - off);
      if (n <= 0) {
        // no progress without an error: back off like EAGAIN, but never spin forever
        if (++zeroWrites > MAX_ZERO_WRITES) return false;
        sleepSync(2);
        continue;
      }
      off += n;
      blocked = 0;
      zeroWrites = 0;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "EAGAIN" && blocked < MAX_BLOCKED_MS) {
        sleepSync(2);
        blocked += 2;
        continue;
      }
      return false; // EPIPE (reader gone), EIO, ...
    }
  }
  return true;
}

/**
 * Synchronous write to stdout (fd 1), for the last words before process.exit (an async write
 * to a pipe could be cut off). Never throws.
 */
export function writeStdoutSync(text: string): boolean {
  if (isStreamDead(process.stdout)) return false;
  return writeFdSync(1, text);
}

let jsonSink: (text: string) => void = (text) => void writeStdoutSync(text);

/** Writes a --json document to stdout synchronously (so process.exit right after cannot truncate it). */
export function writeJsonStdout(text: string): void {
  jsonSink(text);
}

/** Test helper: replaces where --json documents go. Returns a function that restores the default. */
export function setJsonSinkForTests(sink: (text: string) => void): () => void {
  const prev = jsonSink;
  jsonSink = sink;
  return () => {
    jsonSink = prev;
  };
}

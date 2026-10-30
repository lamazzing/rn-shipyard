/**
 * Cleanups that must run if the process is interrupted or dies. Each has an async form (the
 * primary path) and an optional synchronous form (runSyncCleanups, the last resort in
 * process.on('exit')).
 *
 * An entry stays registered until its OWNER calls `unregister()`; running it does not remove
 * it. That keeps the sync fallback available if the process exits in the middle of an async
 * restore (a truncated file), whichever path started that restore. Restores are serialized:
 * the async form runs at most once per entry, and every caller (the owner's own `run()` and a
 * signal handler's runCleanups) awaits the same in-flight promise instead of racing it.
 */
interface Entry {
  fn: () => Promise<void>;
  sync?: () => void;
  inflight?: Promise<void>;
}
const entries = new Set<Entry>();

export interface CleanupHandle {
  /** Runs the async cleanup, or joins the run already in flight. Never rejects. */
  run(): Promise<void>;
  /** Removes the entry; call it only after run() has finished. */
  unregister(): void;
}

function runEntry(entry: Entry): Promise<void> {
  if (!entry.inflight) {
    entry.inflight = (async () => {
      try {
        await entry.fn();
      } catch {
        // best effort
      }
    })();
  }
  return entry.inflight;
}

/** Register a cleanup. */
export function registerCleanup(fn: () => Promise<void>, sync?: () => void): CleanupHandle {
  const entry: Entry = { fn, sync };
  entries.add(entry);
  return {
    run: () => runEntry(entry),
    unregister: () => {
      entries.delete(entry);
    },
  };
}

/** Runs (or joins) every registered async cleanup. Entries stay registered for the sync fallback. */
export async function runCleanups(): Promise<void> {
  for (const entry of [...entries]) await runEntry(entry);
}

/**
 * Synchronous last resort for process.on('exit'): runs the sync form of every entry that is
 * still registered. The sync forms are idempotent (they rewrite only files that differ from
 * their snapshot), so running them after a completed async restore is a no-op.
 */
export function runSyncCleanups(): void {
  for (const entry of [...entries]) {
    try {
      entry.sync?.();
    } catch {
      // best effort
    }
  }
}

/** Test helper: forget every entry. */
export function clearCleanupsForTests(): void {
  entries.clear();
}

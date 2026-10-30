import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Files `expo prebuild` / its install step may rewrite in the user's project. */
export const PROTECTED_PROJECT_FILES = [
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
];

/** name -> exact bytes, or null if the file did not exist. */
export type FileSnapshot = Map<string, Buffer | null>;

export async function snapshotFiles(
  dir: string,
  names: string[] = PROTECTED_PROJECT_FILES
): Promise<FileSnapshot> {
  const snap: FileSnapshot = new Map();
  for (const name of names) {
    snap.set(name, await readFile(join(dir, name)).catch(() => null));
  }
  return snap;
}

export interface RestoreReport {
  restored: string[];
  /** Files that did not exist before but do now. Never deleted: they are left for the user. */
  created: string[];
  failed: string[];
}

/** Byte-exact restore. Never creates a file that did not exist and never deletes one. */
export async function restoreFiles(
  dir: string,
  snap: FileSnapshot
): Promise<RestoreReport> {
  const report: RestoreReport = { restored: [], created: [], failed: [] };
  for (const [name, before] of snap) {
    const path = join(dir, name);
    const after = await readFile(path).catch(() => null);
    if (before === null) {
      if (after !== null) report.created.push(name);
      continue;
    }
    if (after !== null && after.equals(before)) continue;
    try {
      await writeFile(path, before);
      report.restored.push(name);
    } catch {
      report.failed.push(name);
    }
  }
  return report;
}

/**
 * Synchronous twin of restoreFiles for process.on('exit') and crash handlers, where nothing
 * async can run. Idempotent with restoreFiles: a file that already matches is not rewritten.
 */
export function restoreFilesSync(dir: string, snap: FileSnapshot): RestoreReport {
  const report: RestoreReport = { restored: [], created: [], failed: [] };
  for (const [name, before] of snap) {
    const path = join(dir, name);
    let after: Buffer | null = null;
    try {
      after = readFileSync(path);
    } catch {
      after = null;
    }
    if (before === null) {
      if (after !== null) report.created.push(name);
      continue;
    }
    if (after !== null && after.equals(before)) continue;
    try {
      writeFileSync(path, before);
      report.restored.push(name);
    } catch {
      report.failed.push(name);
    }
  }
  return report;
}

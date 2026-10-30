import { stat } from "node:fs/promises";
import { exec, type ExecOptions, type ExecResult } from "../utils/shell.js";

/** exec() that reports "could not start" (command not found) as undefined instead of throwing. */
export async function tryExec(
  cmd: string,
  args: string[],
  opts: ExecOptions = {}
): Promise<ExecResult | undefined> {
  try {
    return await exec(cmd, args, opts); // piped children always run non-interactive
  } catch {
    return undefined;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** [major, minor, patch] from the first dotted number in `text`. */
export function parseVersion(text: string): number[] | undefined {
  const m = text.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function versionAtLeast(version: number[], min: number[]): boolean {
  for (let i = 0; i < min.length; i++) {
    const a = version[i] ?? 0;
    if (a !== min[i]) return a > min[i];
  }
  return true;
}

/** Same as the ~ shortcut users type: shows the home directory as ~ in messages. */
export function tildify(path: string, home: string | undefined): string {
  return home && path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

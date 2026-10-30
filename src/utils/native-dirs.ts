import { stat, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, dirname, basename } from "node:path";
import { exec } from "./shell.js";

export type NativePlatform = "ios" | "android";

/**
 * - absent:    no native folder, prebuild generates it
 * - ignored:   exists and is git-ignored (continuous native generation): prebuild may regenerate it
 * - tracked:   files are committed: hand-maintained native project, prebuild must NOT run
 * - untracked: exists, is not committed and is not git-ignored: `expo prebuild --clean` would
 *              delete work that git cannot bring back, so the platform is refused
 * - not-git:   exists and the project is not under git: we cannot tell, so we must not delete it
 */
export type NativeDirState = "absent" | "ignored" | "tracked" | "untracked" | "not-git";

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function nativeDirState(projectDir: string, platform: NativePlatform): Promise<NativeDirState> {
  if (!(await isDir(join(projectDir, platform)))) return "absent";
  try {
    const inside = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectDir });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return "not-git";
    const listed = await exec("git", ["ls-files", "--", platform], { cwd: projectDir });
    if (listed.exitCode !== 0) return "not-git";
    if (listed.stdout.trim() !== "") return "tracked";
    const ignored = await exec("git", ["check-ignore", "-q", "--", platform], { cwd: projectDir });
    return ignored.exitCode === 0 ? "ignored" : "untracked";
  } catch {
    return "not-git"; // git missing or failed to start
  }
}

/** realpath of the deepest existing ancestor, with the missing tail appended (the file may not exist yet). */
async function realpathLoose(path: string): Promise<string> {
  const tail: string[] = [];
  let cur = resolve(path);
  for (;;) {
    try {
      return join(await realpath(cur), ...tail.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(path);
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

/**
 * The native folder (`<project>/ios` or `<project>/android`) that `path` lives in, if any.
 * `expo prebuild --clean` deletes those folders recursively, so a keystore or credentials file
 * stored there would be destroyed. Symlinks are resolved.
 */
export async function nativeDirContaining(projectDir: string, path: string): Promise<NativePlatform | undefined> {
  const root = await realpathLoose(projectDir);
  const target = await realpathLoose(path);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  const first = rel.split(/[\\/]/)[0];
  return first === "ios" || first === "android" ? first : undefined;
}

/** Shared by init and build. */
export function secretInNativeDirMessage(label: string, path: string, dir: NativePlatform): { message: string; fix: string } {
  return {
    message: `${label} ${path} is inside ${dir}/, which 'expo prebuild --clean' deletes recursively`,
    fix: "move it to .shipyard/android/ or outside the project",
  };
}

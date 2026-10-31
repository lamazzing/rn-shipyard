import { readHistory, type HistoryEntry } from "../core/history.js";
import { resolvePath } from "../core/paths.js";
import { isFile } from "./helpers.js";
import type { Platform } from "./types.js";

/**
 * Artifact of the latest successful build of `platform` in history whose file still exists
 * (what `submit` would upload), or undefined when there is none.
 */
export async function latestArtifact(projectDir: string, platform: Platform): Promise<string | undefined> {
  const history = await readHistory(projectDir);
  for (const entry of [...history.entries].reverse()) {
    if (entry.command !== "build") continue;
    const result = entry.platforms[platform];
    if (result?.status !== "success" || !result.artifactPath) continue;
    const path = resolvePath(projectDir, result.artifactPath);
    if (await isFile(path)) return path;
  }
  return undefined;
}

/** True when history holds at least one successful build on any platform. */
export async function hasSuccessfulBuild(projectDir: string): Promise<boolean> {
  const history = await readHistory(projectDir);
  return history.entries.some((e: HistoryEntry) =>
    e.command === "build" && Object.values(e.platforms).some((r) => r?.status === "success")
  );
}

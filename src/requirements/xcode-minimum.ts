import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Minimum Xcode per Expo SDK major, from the "Support for Android and iOS versions" table in
 * Expo's SDK reference (Xcode version column), read on 2026-11-02:
 *   https://docs.expo.dev/versions/latest/   (SDK 56, 57, 58)
 *   https://docs.expo.dev/versions/v55.0.0/  (SDK 53, 54, 55)
 * SDK 52 is not in the table, so it is deliberately absent (it uses the fallback).
 */
// Update this table with each Expo SDK release.
export const XCODE_MIN_BY_SDK: Record<number, number[]> = {
  53: [16, 0],
  54: [16, 1],
  55: [26, 2],
  56: [26, 4],
  57: [26, 4],
  58: [26, 4],
};

/** Lowest minimum in the table, used for an Expo SDK the table does not list. */
export const XCODE_MIN_FALLBACK: number[] = [16, 0];

/** Minimum when there is no project or no Expo: the old generic check. */
export const XCODE_MIN_GENERIC: number[] = [15];

export function formatVersion(v: number[]): string {
  return v.join(".");
}

/** Numeric, segment by segment: 26.4 > 26.3.1, 26.4.0 equals 26.4, 16.10 > 16.9. */
export function compareVersions(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function firstMajor(text: unknown): number | undefined {
  if (typeof text !== "string") return undefined;
  const m = text.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

/** Expo SDK major: installed node_modules/expo version first, then package.json's `expo` range. */
export async function detectExpoSdk(projectDir: string): Promise<number | undefined> {
  const installed = firstMajor((await readJson(join(projectDir, "node_modules", "expo", "package.json")))?.version);
  if (installed !== undefined) return installed;
  const pkg = await readJson(join(projectDir, "package.json"));
  const deps = pkg?.dependencies as Record<string, unknown> | undefined;
  const dev = pkg?.devDependencies as Record<string, unknown> | undefined;
  return firstMajor(deps?.expo ?? dev?.expo);
}

export interface XcodeMinimum {
  min: number[];
  /** The project's Expo SDK major, when found */
  sdk?: number;
  /** True when the SDK is newer than every table entry (min is then the highest entry's) */
  newer?: boolean;
  /** True when the SDK is in the table (a too-old Xcode then fails instead of warns) */
  known: boolean;
}

export async function xcodeMinimumFor(projectDir: string): Promise<XcodeMinimum> {
  const sdk = await detectExpoSdk(projectDir);
  if (sdk === undefined) return { min: XCODE_MIN_GENERIC, known: false };
  const min = XCODE_MIN_BY_SDK[sdk];
  if (min) return { min, sdk, known: true };
  const highest = Math.max(...Object.keys(XCODE_MIN_BY_SDK).map(Number));
  if (sdk > highest) return { min: XCODE_MIN_BY_SDK[highest], sdk, known: false, newer: true };
  return { min: XCODE_MIN_FALLBACK, sdk, known: false };
}

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";

export interface PlatformResult {
  status: "success" | "error" | "skipped";
  version: string;
  buildNumber?: string;
  versionCode?: number;
  artifactPath?: string;
  durationSeconds: number;
  error: string | null;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  command: "build" | "submit";
  profile: string;
  platforms: {
    ios?: PlatformResult;
    android?: PlatformResult;
  };
}

export interface HistoryData {
  entries: HistoryEntry[];
}

const SHIPYARD_DIR = ".shipyard";
const HISTORY_FILE = "history.json";

function historyPath(projectDir: string): string {
  return join(projectDir, SHIPYARD_DIR, HISTORY_FILE);
}

export async function readHistory(projectDir: string): Promise<HistoryData> {
  try {
    const raw = await readFile(historyPath(projectDir), "utf-8");
    return JSON.parse(raw) as HistoryData;
  } catch {
    return { entries: [] };
  }
}

export async function appendHistory(
  projectDir: string,
  entry: Omit<HistoryEntry, "id" | "timestamp">
): Promise<HistoryEntry> {
  const history = await readHistory(projectDir);
  const fullEntry: HistoryEntry = {
    id: uuidv4().slice(0, 8),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  history.entries.push(fullEntry);

  const dir = join(projectDir, SHIPYARD_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(historyPath(projectDir), JSON.stringify(history, null, 2) + "\n");

  return fullEntry;
}

export interface HistoryQuery {
  platform?: "ios" | "android";
  limit?: number;
}

export async function queryHistory(
  projectDir: string,
  query: HistoryQuery = {}
): Promise<HistoryEntry[]> {
  const history = await readHistory(projectDir);
  let entries = history.entries;

  if (query.platform) {
    entries = entries.filter((e) => e.platforms[query.platform!] !== undefined);
  }

  // Most recent first
  entries = entries.reverse();

  if (query.limit && query.limit > 0) {
    entries = entries.slice(0, query.limit);
  }

  return entries;
}

export function getLastSuccessfulBuild(
  history: HistoryData,
  platform?: "ios" | "android"
): HistoryEntry | undefined {
  const buildEntries = history.entries
    .filter((e) => e.command === "build")
    .reverse();

  for (const entry of buildEntries) {
    if (platform) {
      const result = entry.platforms[platform];
      if (result?.status === "success") return entry;
    } else {
      const ios = entry.platforms.ios;
      const android = entry.platforms.android;
      if (ios?.status === "success" || android?.status === "success") return entry;
    }
  }

  return undefined;
}

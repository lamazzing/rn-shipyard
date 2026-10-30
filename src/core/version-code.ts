import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readHistory } from "./history.js";
import { ShipyardError } from "../utils/errors.js";

/**
 * Android versionCode rule (never reuse a code):
 *
 *   lastUsed = max(.shipyard/version-code.json android.lastUsed,
 *                  highest versionCode of any successful android build in history)
 *   next     = max(app.json android.versionCode ?? 1, lastUsed + 1)
 *
 * --version-code <n> overrides the rule but must be > lastUsed.
 * The counter is only advanced after a successful build.
 * The file holds a number only, never secrets, and is safe to commit.
 */

const FILE = "version-code.json";

interface CounterFile {
  android?: { lastUsed?: number };
}

function counterPath(projectDir: string): string {
  return join(projectDir, ".shipyard", FILE);
}

async function readCounter(projectDir: string): Promise<CounterFile> {
  try {
    return JSON.parse(await readFile(counterPath(projectDir), "utf-8"));
  } catch {
    return {};
  }
}

export async function getLastUsedAndroidVersionCode(
  projectDir: string
): Promise<number> {
  const counter = (await readCounter(projectDir)).android?.lastUsed ?? 0;
  let fromHistory = 0;
  try {
    const history = await readHistory(projectDir);
    for (const entry of history.entries) {
      const a = entry.platforms.android;
      if (entry.command === "build" && a?.status === "success" && a.versionCode) {
        fromHistory = Math.max(fromHistory, a.versionCode);
      }
    }
  } catch {
    // no history yet
  }
  return Math.max(counter, fromHistory);
}

export async function recordAndroidVersionCode(
  projectDir: string,
  versionCode: number
): Promise<void> {
  const current = await getLastUsedAndroidVersionCode(projectDir);
  const file = await readCounter(projectDir);
  file.android = { lastUsed: Math.max(current, versionCode) };
  await mkdir(join(projectDir, ".shipyard"), { recursive: true });
  await writeFile(counterPath(projectDir), JSON.stringify(file, null, 2) + "\n");
}

export interface ResolvedVersionCode {
  versionCode: number;
  lastUsed: number;
  source: "override" | "app.json" | "counter";
}

export async function resolveAndroidVersionCode(
  projectDir: string,
  appJsonVersionCode: number | undefined,
  override?: number
): Promise<ResolvedVersionCode> {
  const lastUsed = await getLastUsedAndroidVersionCode(projectDir);

  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 1) {
      throw new ShipyardError(
        "INVALID_VERSION_CODE",
        `Invalid --version-code: ${override}`,
        "Pass a positive integer"
      );
    }
    if (override <= lastUsed) {
      throw new ShipyardError(
        "VERSION_CODE_REUSED",
        `versionCode ${override} was already used (last used: ${lastUsed})`,
        `Use a value greater than ${lastUsed}, or omit --version-code`
      );
    }
    return { versionCode: override, lastUsed, source: "override" };
  }

  const fromApp = appJsonVersionCode ?? 1;
  if (fromApp > lastUsed) {
    return { versionCode: fromApp, lastUsed, source: "app.json" };
  }
  return { versionCode: lastUsed + 1, lastUsed, source: "counter" };
}

import { readHistory } from "./history.js";
import { readCounter, writeCounter } from "./version-code.js";
import { ShipyardError } from "../utils/errors.js";

/**
 * iOS build number (CFBundleVersion) rule, the twin of the Android versionCode rule. App Store
 * Connect rejects a reused build number, so one is never reused:
 *
 *   lastUsed = max(.shipyard/version-code.json ios.lastUsed,
 *                  highest numeric buildNumber of any successful ios build in history)
 *   local    = max(app.json ios.buildNumber (integer only) ?? 1, lastUsed + 1)
 *
 * With an App Store Connect API key the build lane also reads the latest TestFlight build number
 * L and uses max(local, L + 1) (like EAS remote versioning). --build-number <n> overrides the rule
 * but must be > lastUsed (and > L when TestFlight can be read). The counter advances only after a
 * successful build. The number is applied to the GENERATED Info.plist; app.json is never modified.
 */

/** In the iOS artifact name: replaced with the final build number (known only after TestFlight was asked). */
export const BUILD_NUMBER_TOKEN = "__BUILD_NUMBER__";

const INT = /^\d+$/;

export async function getLastUsedIosBuildNumber(projectDir: string): Promise<number> {
  const counter = (await readCounter(projectDir)).ios?.lastUsed ?? 0;
  let fromHistory = 0;
  try {
    const history = await readHistory(projectDir);
    for (const entry of history.entries) {
      const i = entry.platforms.ios;
      if (entry.command === "build" && i?.status === "success" && i.buildNumber && INT.test(String(i.buildNumber))) {
        fromHistory = Math.max(fromHistory, Number(i.buildNumber));
      }
    }
  } catch {
    // no history yet
  }
  return Math.max(counter, fromHistory);
}

export async function recordIosBuildNumber(projectDir: string, buildNumber: number): Promise<void> {
  const current = await getLastUsedIosBuildNumber(projectDir);
  const file = await readCounter(projectDir);
  file.ios = { lastUsed: Math.max(current, buildNumber) };
  await writeCounter(projectDir, file);
}

export interface ResolvedBuildNumber {
  buildNumber: number;
  lastUsed: number;
  source: "override" | "app.json" | "counter";
  /** app.json's buildNumber was set but is not an integer, so it was ignored */
  ignoredAppValue?: string;
}

export async function resolveIosBuildNumber(
  projectDir: string,
  appJsonBuildNumber: string | number | undefined,
  override?: number
): Promise<ResolvedBuildNumber> {
  const lastUsed = await getLastUsedIosBuildNumber(projectDir);

  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 1) {
      throw new ShipyardError(
        "INVALID_BUILD_NUMBER",
        `Invalid --build-number: ${override}`,
        "Pass a positive integer"
      );
    }
    if (override <= lastUsed) {
      throw new ShipyardError(
        "BUILD_NUMBER_REUSED",
        `Build number ${override} was already used (last used: ${lastUsed})`,
        `Use a value greater than ${lastUsed}, or omit --build-number`
      );
    }
    return { buildNumber: override, lastUsed, source: "override" };
  }

  const raw = appJsonBuildNumber === undefined ? undefined : String(appJsonBuildNumber).trim();
  const fromApp = raw !== undefined && INT.test(raw) && Number(raw) >= 1 ? Number(raw) : undefined;
  const ignoredAppValue = raw !== undefined && raw !== "" && fromApp === undefined ? raw : undefined;
  if ((fromApp ?? 1) > lastUsed) {
    return { buildNumber: fromApp ?? 1, lastUsed, source: "app.json", ...(ignoredAppValue ? { ignoredAppValue } : {}) };
  }
  return { buildNumber: lastUsed + 1, lastUsed, source: "counter", ...(ignoredAppValue ? { ignoredAppValue } : {}) };
}

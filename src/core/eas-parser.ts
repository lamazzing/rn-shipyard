import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ShipyardError } from "../utils/errors.js";

export interface EasBuildProfile {
  distribution?: string;
  ios?: Record<string, unknown>;
  android?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EasSubmitConfig {
  ios?: {
    appleId?: string;
    ascAppId?: string;
    appleTeamId?: string;
    [key: string]: unknown;
  };
  android?: {
    serviceAccountKeyPath?: string;
    track?: string;
    [key: string]: unknown;
  };
}

export interface EasConfig {
  build: Record<string, EasBuildProfile>;
  submit?: Record<string, EasSubmitConfig>;
}

export interface AppConfig {
  name: string;
  slug: string;
  version: string;
  ios?: {
    bundleIdentifier?: string;
    buildNumber?: string;
  };
  android?: {
    package?: string;
    versionCode?: number;
  };
}

export async function parseEasConfig(projectDir: string): Promise<EasConfig> {
  const easPath = join(projectDir, "eas.json");
  let raw: string;

  try {
    raw = await readFile(easPath, "utf-8");
  } catch {
    throw new ShipyardError(
      "MISSING_CONFIG_EAS",
      "eas.json not found in project directory",
      "Create an eas.json file or run 'eas build:configure' first"
    );
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.build) {
      throw new ShipyardError(
        "INVALID_EAS_CONFIG",
        "eas.json is missing the 'build' section",
        "Add a 'build' section with at least one profile to eas.json"
      );
    }
    return parsed as EasConfig;
  } catch (err) {
    if (err instanceof ShipyardError) throw err;
    throw new ShipyardError(
      "INVALID_EAS_CONFIG",
      "Failed to parse eas.json",
      "Check that eas.json contains valid JSON"
    );
  }
}

export async function parseAppConfig(projectDir: string): Promise<AppConfig> {
  // Try app.json first
  const appJsonPath = join(projectDir, "app.json");
  try {
    const raw = await readFile(appJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    const expo = parsed.expo ?? parsed;
    return extractAppConfig(expo);
  } catch (err) {
    if (err instanceof ShipyardError) throw err;
    // fall through to app.config.js
  }

  // Try app.config.js
  const appConfigJsPath = join(projectDir, "app.config.js");
  try {
    const raw = await readFile(appConfigJsPath, "utf-8");
    // Simple extraction: look for module.exports or export default
    // For full support we'd need to evaluate the JS, but for MVP we parse JSON-like structures
    throw new Error("app.config.js evaluation not supported yet");
  } catch {
    // fall through
  }

  // Try app.config.ts
  throw new ShipyardError(
    "MISSING_CONFIG_APP",
    "No app.json or app.config.js found in project directory",
    "Create an app.json with your app configuration"
  );
}

function extractAppConfig(expo: Record<string, unknown>): AppConfig {
  if (!expo.name || !expo.slug || !expo.version) {
    throw new ShipyardError(
      "INVALID_APP_CONFIG",
      "app.json is missing required fields (name, slug, or version)",
      "Ensure app.json has expo.name, expo.slug, and expo.version"
    );
  }

  const ios = expo.ios as Record<string, unknown> | undefined;
  const android = expo.android as Record<string, unknown> | undefined;

  return {
    name: String(expo.name),
    slug: String(expo.slug),
    version: String(expo.version),
    ios: ios
      ? {
          bundleIdentifier: ios.bundleIdentifier as string | undefined,
          buildNumber: ios.buildNumber as string | undefined,
        }
      : undefined,
    android: android
      ? {
          package: android.package as string | undefined,
          versionCode: android.versionCode as number | undefined,
        }
      : undefined,
  };
}

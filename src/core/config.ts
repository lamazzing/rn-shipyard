import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { ShipyardError } from "../utils/errors.js";
import { resolvePath, toPortablePath } from "./paths.js";

export interface PlatformIosConfig {
  enabled: boolean;
  signingMethod: "match";
  matchGitUrl: string;
  matchType: string;
  teamId: string;
  bundleId: string;
}

export interface PlatformAndroidConfig {
  enabled: boolean;
  keystorePath: string;
  keystoreAlias: string;
  /** JSON file outside the repo: { keystorePassword, keyAlias, keyPassword } */
  credentialsPath?: string;
  serviceAccountKeyPath?: string;
}

export interface ShipyardConfig {
  version: string;
  createdAt: string;
  platforms: {
    ios?: PlatformIosConfig;
    android?: PlatformAndroidConfig;
  };
  outputDir: string;
}

const SHIPYARD_DIR = ".shipyard";
const CONFIG_FILE = "config.json";

function configPath(projectDir: string): string {
  return join(projectDir, SHIPYARD_DIR, CONFIG_FILE);
}

export async function configExists(projectDir: string): Promise<boolean> {
  try {
    await access(configPath(projectDir));
    return true;
  } catch {
    return false;
  }
}

export async function readConfig(projectDir: string): Promise<ShipyardConfig> {
  const path = configPath(projectDir);
  let raw: string;

  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new ShipyardError(
      "MISSING_CONFIG_SHIPYARD",
      ".shipyard/config.json not found",
      "Run 'rn-shipyard init' to set up the project first"
    );
  }

  try {
    const config = JSON.parse(raw) as ShipyardConfig;
    if (!config.version || !config.platforms) {
      throw new Error("Invalid schema");
    }
    return resolveConfigPaths(projectDir, config);
  } catch (err) {
    if (err instanceof ShipyardError) throw err;
    throw new ShipyardError(
      "INVALID_CONFIG",
      ".shipyard/config.json has invalid format",
      "Delete .shipyard/config.json and run 'rn-shipyard init' again"
    );
  }
}

/**
 * The current .shipyard/config.json (paths resolved), or undefined when there is none. An
 * unreadable or invalid file throws INVALID_CONFIG: init must never overwrite it silently.
 */
export async function readExistingConfig(projectDir: string): Promise<ShipyardConfig | undefined> {
  if (!(await configExists(projectDir))) return undefined;
  return readConfig(projectDir);
}

function mapAndroidPaths(
  android: PlatformAndroidConfig,
  fn: (p: string) => string
): PlatformAndroidConfig {
  return {
    ...android,
    keystorePath: fn(android.keystorePath),
    credentialsPath: android.credentialsPath ? fn(android.credentialsPath) : undefined,
    serviceAccountKeyPath: android.serviceAccountKeyPath
      ? fn(android.serviceAccountKeyPath)
      : undefined,
  };
}

/** Stored paths ("~/x", project-relative or legacy absolute) -> absolute, at read time. */
function resolveConfigPaths(projectDir: string, config: ShipyardConfig): ShipyardConfig {
  const android = config.platforms.android;
  if (!android) return config;
  return {
    ...config,
    platforms: {
      ...config.platforms,
      android: mapAndroidPaths(android, (p) => resolvePath(projectDir, p)),
    },
  };
}

/** Absolute paths -> project-relative or "~/x" so the file has no machine-specific prefix. */
function portableConfig(projectDir: string, config: ShipyardConfig): ShipyardConfig {
  const android = config.platforms.android;
  if (!android) return config;
  return {
    ...config,
    platforms: {
      ...config.platforms,
      android: mapAndroidPaths(android, (p) => toPortablePath(projectDir, p)),
    },
  };
}

export async function writeConfig(
  projectDir: string,
  config: ShipyardConfig
): Promise<void> {
  const dir = join(projectDir, SHIPYARD_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(configPath(projectDir), JSON.stringify(portableConfig(projectDir, config), null, 2) + "\n");
}

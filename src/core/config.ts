import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { ShipyardError } from "../utils/errors.js";

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
    return config;
  } catch (err) {
    if (err instanceof ShipyardError) throw err;
    throw new ShipyardError(
      "INVALID_CONFIG",
      ".shipyard/config.json has invalid format",
      "Delete .shipyard/config.json and run 'rn-shipyard init' again"
    );
  }
}

export async function writeConfig(
  projectDir: string,
  config: ShipyardConfig
): Promise<void> {
  const dir = join(projectDir, SHIPYARD_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(configPath(projectDir), JSON.stringify(config, null, 2) + "\n");
}

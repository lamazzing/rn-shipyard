import { readFile, access } from "node:fs/promises";
import type { PlatformAndroidConfig } from "../../core/config.js";
import { resolvePath } from "../../core/paths.js";
import { ShipyardError } from "../../utils/errors.js";

export interface AndroidCredentials {
  keystorePath: string;
  keyAlias: string;
  keystorePassword: string;
  keyPassword: string;
}

export { resolvePath };

/**
 * Passwords come from env (ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_PASSWORD) first,
 * then from the JSON file at config.credentialsPath
 * ({ keystorePassword, keyAlias, keyPassword }). The file lives outside the repo.
 */
export async function loadAndroidCredentials(
  projectDir: string,
  config: PlatformAndroidConfig
): Promise<AndroidCredentials> {
  const keystorePath = resolvePath(projectDir, config.keystorePath);
  try {
    await access(keystorePath);
  } catch {
    throw new ShipyardError(
      "KEYSTORE_NOT_FOUND",
      `Keystore not found at ${keystorePath}`,
      "Run 'rn-shipyard init --platform android' or fix keystorePath in .shipyard/config.json"
    );
  }

  let fromFile: Partial<AndroidCredentials> = {};
  if (config.credentialsPath) {
    const credPath = resolvePath(projectDir, config.credentialsPath);
    try {
      fromFile = JSON.parse(await readFile(credPath, "utf-8"));
    } catch {
      throw new ShipyardError(
        "CREDENTIALS_NOT_READABLE",
        `Cannot read Android credentials file at ${credPath}`,
        "Check credentialsPath in .shipyard/config.json (JSON with keystorePassword, keyAlias, keyPassword)"
      );
    }
  }

  const keystorePassword =
    process.env.ANDROID_KEYSTORE_PASSWORD || fromFile.keystorePassword || "";
  const keyPassword =
    process.env.ANDROID_KEY_PASSWORD || fromFile.keyPassword || keystorePassword;
  const keyAlias = fromFile.keyAlias || config.keystoreAlias;

  if (!keystorePassword) {
    throw new ShipyardError(
      "MISSING_CONFIG_ANDROID",
      "No keystore password available",
      "Set ANDROID_KEYSTORE_PASSWORD or point credentialsPath at a JSON file with keystorePassword"
    );
  }

  return { keystorePath, keyAlias, keystorePassword, keyPassword };
}

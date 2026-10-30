/**
 * EAS-compatible names for Apple / App Store Connect credentials, mapped onto the names
 * fastlane reads. An explicit fastlane variable always wins over its EXPO_* alias.
 */
export const EXPO_ENV_ALIASES: Record<string, string> = {
  EXPO_APPLE_ID: "FASTLANE_USER",
  EXPO_APPLE_PASSWORD: "FASTLANE_PASSWORD",
  EXPO_APPLE_APP_SPECIFIC_PASSWORD: "FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD",
  EXPO_APPLE_TEAM_ID: "FASTLANE_TEAM_ID",
  EXPO_ASC_API_KEY_PATH: "APP_STORE_CONNECT_API_KEY_KEY_FILEPATH",
  EXPO_ASC_KEY_ID: "APP_STORE_CONNECT_API_KEY_KEY_ID",
  EXPO_ASC_ISSUER_ID: "APP_STORE_CONNECT_API_KEY_ISSUER_ID",
};

/**
 * Copies every set EXPO_* alias onto its fastlane name unless that is already set (non-empty).
 * Mutates and returns `env` (default process.env), so every child inherits the mapping.
 */
export function applyExpoEnvAliases<T extends Record<string, string | undefined>>(
  env: T = process.env as unknown as T
): T {
  const out = env as Record<string, string | undefined>;
  for (const [alias, target] of Object.entries(EXPO_ENV_ALIASES)) {
    const value = out[alias];
    if (value && !out[target]) out[target] = value;
  }
  return env;
}

/** App Store Connect API key triple present (fastlane names, after applyExpoEnvAliases). */
export function hasAscApiKey(env: Record<string, string | undefined>): boolean {
  return (
    !!env.APP_STORE_CONNECT_API_KEY_KEY_ID &&
    !!env.APP_STORE_CONNECT_API_KEY_ISSUER_ID &&
    !!(env.APP_STORE_CONNECT_API_KEY_KEY || env.APP_STORE_CONNECT_API_KEY_KEY_FILEPATH)
  );
}

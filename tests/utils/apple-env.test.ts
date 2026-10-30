import { describe, it, expect } from "vitest";
import { applyExpoEnvAliases, hasAscApiKey, EXPO_ENV_ALIASES } from "../../src/utils/apple-env.js";
import { collectSecrets, SECRET_ENV_VARS } from "../../src/utils/secrets.js";
import { redactSecrets } from "../../src/utils/shell.js";

describe("applyExpoEnvAliases", () => {
  it("maps every EXPO_* name to its fastlane name", () => {
    const env: Record<string, string | undefined> = {
      EXPO_APPLE_ID: "me@example.com",
      EXPO_APPLE_PASSWORD: "pw",
      EXPO_APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
      EXPO_APPLE_TEAM_ID: "TEAM123",
      EXPO_ASC_API_KEY_PATH: "/k/AuthKey.p8",
      EXPO_ASC_KEY_ID: "KEYID",
      EXPO_ASC_ISSUER_ID: "ISSUER",
    };
    applyExpoEnvAliases(env);
    expect(env).toMatchObject({
      FASTLANE_USER: "me@example.com",
      FASTLANE_PASSWORD: "pw",
      FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
      FASTLANE_TEAM_ID: "TEAM123",
      APP_STORE_CONNECT_API_KEY_KEY_FILEPATH: "/k/AuthKey.p8",
      APP_STORE_CONNECT_API_KEY_KEY_ID: "KEYID",
      APP_STORE_CONNECT_API_KEY_ISSUER_ID: "ISSUER",
    });
    expect(hasAscApiKey(env)).toBe(true);
    expect(Object.keys(EXPO_ENV_ALIASES)).toHaveLength(7);
  });

  it("an explicit fastlane variable wins over the alias; an empty one does not", () => {
    const env: Record<string, string | undefined> = {
      EXPO_APPLE_ID: "alias@example.com",
      FASTLANE_USER: "explicit@example.com",
      EXPO_APPLE_PASSWORD: "alias-pw",
      FASTLANE_PASSWORD: "",
    };
    applyExpoEnvAliases(env);
    expect(env.FASTLANE_USER).toBe("explicit@example.com");
    expect(env.FASTLANE_PASSWORD).toBe("alias-pw");
  });

  it("does nothing when no alias is set", () => {
    const env: Record<string, string | undefined> = { PATH: "/bin" };
    applyExpoEnvAliases(env);
    expect(env).toEqual({ PATH: "/bin" });
  });
});

describe("EXPO_* secrets are redacted", () => {
  it("both secret aliases are in SECRET_ENV_VARS and collected from the env", () => {
    expect(SECRET_ENV_VARS).toContain("EXPO_APPLE_PASSWORD");
    expect(SECRET_ENV_VARS).toContain("EXPO_APPLE_APP_SPECIFIC_PASSWORD");
    const secrets = collectSecrets({
      EXPO_APPLE_PASSWORD: "hunter2-secret",
      EXPO_APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
      EXPO_APPLE_ID: "me@example.com",
    });
    expect(redactSecrets("pw hunter2-secret and abcd-efgh-ijkl-mnop for me@example.com", secrets)).toBe(
      "pw *** and *** for me@example.com"
    );
  });
});

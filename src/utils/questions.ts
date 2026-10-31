/**
 * Every interactive question rn-shipyard can ask, by stable id, and how the same answer is given
 * without a terminal. `Prompter.ask(id, ...)` only accepts an id from this table (a type error
 * otherwise), and tests/qa/contracts.test.ts fails when
 *   - a prompt call in src/ has no id from this table,
 *   - an id here is never asked (stale row),
 *   - a row names a flag that the CLI does not have or an env var that no source file reads.
 * A new question therefore cannot ship without its non-interactive equivalent.
 */
export interface QuestionDef {
  /** What the question asks, for humans reading a failing contract test */
  about: string;
  /** Command-line flags that answer it (must exist on a command) */
  flags?: string[];
  /** Environment variables that answer it (must be read somewhere in src/) */
  env?: string[];
  /** Config the answer is read from instead (app config, eas.json, .shipyard/config.json) */
  config?: string;
  /** Non-interactive behaviour when none of the above applies, e.g. "never asked" */
  otherwise?: string;
}

export const QUESTIONS = {
  "submit.apple-login": {
    about: "Log in to your Apple account now? (build --submit)",
    env: ["FASTLANE_USER"],
    otherwise: "never asked: submit uses the App Store Connect API key or FASTLANE_USER / FASTLANE_PASSWORD from the environment",
  },
  "init.eas-credentials-download": {
    about: "Run `npx eas-cli credentials` now to download the credentials?",
    flags: ["--from-eas"],
    otherwise: "never asked: --from-eas fails with EAS_CREDENTIALS_NOT_FOUND until credentials.json exists",
  },
  "init.android.replace-keystore": {
    about: "A different keystore already exists. Replace it?",
    otherwise: "never replaced without a terminal: the existing keystore is kept",
  },
  "init.ios.bundle-id": {
    about: "iOS Bundle Identifier",
    config: "ios.bundleIdentifier in app.json / app.config.*",
  },
  "init.ios.team-id": {
    about: "Apple Team ID",
    env: ["APPLE_TEAM_ID"],
    config: "eas.json submit.production.ios.appleTeamId",
  },
  "init.ios.match-git-url": {
    about: "Match Git URL",
    env: ["MATCH_GIT_URL"],
  },
  "init.ios.save-match-password": {
    about: "Save the Match password in the macOS keychain?",
    flags: ["--save-match-password"],
    env: ["MATCH_PASSWORD"],
  },
  "init.ios.match-password": {
    about: "Match password (encrypts the certificates in the Match repo)",
    env: ["MATCH_PASSWORD"],
  },
  "init.ios.match-password-repeat": {
    about: "Repeat Match password",
    env: ["MATCH_PASSWORD"],
  },
  "init.android.keystore-password": {
    about: "Keystore password",
    flags: ["--android-credentials"],
    env: ["ANDROID_KEYSTORE_PASSWORD"],
  },
  "init.android.keystore-password-repeat": {
    about: "Repeat keystore password",
    env: ["ANDROID_KEYSTORE_PASSWORD"],
  },
  "init.android.key-password": {
    about: "Key password (Enter for same as keystore)",
    env: ["ANDROID_KEY_PASSWORD"],
  },
} as const satisfies Record<string, QuestionDef>;

export type QuestionId = keyof typeof QUESTIONS;

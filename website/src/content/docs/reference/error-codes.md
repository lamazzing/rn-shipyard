---
title: Error codes
description: Every error code rn-shipyard can return, what it means and how to fix it.
---

Errors appear as text, or with `--json` as `{ "success": false, "error": { "code", "message", "fix" } }`. The Exit column is the exit code of the command. Every code starting with `MISSING_CONFIG` exits `2`, `INTERRUPTED` exits `130` (`143` for SIGTERM, `129` for SIGHUP), everything else exits `1`. Two codes exit `2` only from `init`: `KEYSTORE_NOT_FOUND` and `CREDENTIALS_NOT_READABLE`. `EAS_CREDENTIALS_NOT_FOUND` also exits `2`.

The Fix column is the fix text the tool prints, shortened to one line. The `--json` `error.fix` has the full text.

## Setup and config

| Code | Exit | Meaning | Fix |
|---|---|---|---|
| `MISSING_CONFIG_SHIPYARD` | 2 | `.shipyard/config.json` not found | Run `rn-shipyard init` to set up the project first |
| `INVALID_CONFIG` | 1 | `.shipyard/config.json` has an invalid format | Delete it and run `rn-shipyard init` again |
| `MISSING_CONFIG_EAS` | 2 | `eas.json` not found | Create `eas.json` or run `eas build:configure` |
| `INVALID_EAS_CONFIG` | 1 | `eas.json` is not valid JSON, or has no `build` section | Check that it contains valid JSON; add a `build` section with at least one profile |
| `MISSING_CONFIG_APP` | 2 | No `app.json`, `app.config.js` or `app.config.ts` found | Create an `app.json` (or `app.config.js` / `app.config.ts`) |
| `INVALID_APP_CONFIG` | 1 | The config is missing `name` or `slug`, or `app.json` is not valid JSON | Add `name` and `slug` (under `expo` in `app.json`), or fix the syntax error |
| `APP_CONFIG_EVAL_FAILED` | 1 | `npx expo config --json` failed for a dynamic config, or the `expo` package is not installed | Run `npx expo config --json` in the project to see the error; run `npm install` (or `npm install expo`) |
| `MISSING_CONFIG_IOS` | 2 | Required iOS values missing in `init` (`APPLE_TEAM_ID`, `MATCH_GIT_URL`, bundle identifier) | Set the missing environment variables or add the values to `eas.json` or your app config |
| `MISSING_CONFIG_IOS_CREDENTIALS` | 2 | No App Store Connect credentials for `submit` | Set an API key (`EXPO_ASC_*` or `APP_STORE_CONNECT_API_KEY_*`), or an Apple ID with a password; or run without `--non-interactive` to log in |
| `MISSING_CONFIG_ANDROID` | 2 | No keystore password, or the credentials file lacks a field | Set `ANDROID_KEYSTORE_PASSWORD` or add the missing fields to the credentials file |
| `MISSING_CONFIG_PROJECT` | 2 | The requirements pre-flight found only project config missing (for example `.shipyard/config.json` or `eas.json`) | Run `rn-shipyard init`, then `rn-shipyard doctor` |
| `REQUIREMENTS_NOT_MET` | 1 | The requirements pre-flight found a blocking problem | Follow the listed fixes, then run `rn-shipyard doctor` (or pass `--skip-checks`) |
| `NO_PLATFORMS` | 1 | No platform enabled in the config, or the one given with `--platform` is not set up (`build`, `submit`) | Run `rn-shipyard init --platform <ios\|android>` |
| `INVALID_FLAGS` | 1 | Conflicting or invalid flags (`init` Android flags, `doctor --platform`) | Use `--platform android` (or `all`) or drop the Android flags; pass `--android-keystore` with `--android-credentials`; use `--platform ios`, `android` or `all` |
| `INVALID_USAGE` | 1 | Unknown option or missing argument | Run `rn-shipyard <command> --help` |

## iOS signing and Match

| Code | Exit | Meaning | Fix |
|---|---|---|---|
| `INVALID_MATCH_GIT_URL` | 1 | The Match URL contains credentials, or starts with `-` | Use an SSH URL or a plain `https://` URL, and `MATCH_GIT_BASIC_AUTHORIZATION` for access |
| `MATCH_REPO_AUTH_FAILED` | 1 | The pre-clone of the Match repo before an iOS build failed | Load your key into ssh-agent (`ssh-add --apple-use-keychain ~/.ssh/id_ed25519`) or configure a git credential helper; or run without `--non-interactive` to be prompted |
| `APPLE_LOGIN_FAILED` | 1 | The Apple ID login step before the submit failed (or the Fastfile lacks the login lane) | Check your Apple ID and password, then run `submit` again; or use an App Store Connect API key |
| `FASTLANE_NOT_FOUND` | 1 | Fastlane is not installed | Install Fastlane: `gem install fastlane` (`doctor` suggests `brew install fastlane`) |
| `ASC_KEY_INVALID` | 1 | `init`: App Store Connect rejected the API key (401: wrong key id, issuer id or a revoked key), or the `.p8` is unreadable or not an EC key | Check key id, issuer id and the `.p8` in App Store Connect > Users and Access > Integrations > App Store Connect API |
| `ASC_KEY_FORBIDDEN` | 1 | `init`: the API key is valid but its role cannot read apps (403) | Create a key with the App Manager or Admin role |
| `XCWORKSPACE_NOT_FOUND` | 1 | No `.xcworkspace` in `ios/` | Run `npx expo prebuild --platform ios` and check that CocoaPods installed |
| `XCWORKSPACE_AMBIGUOUS` | 1 | More than one `.xcworkspace` in `ios/` | Keep exactly one workspace in `ios/` (delete stale ones), then build again |

## Importing EAS credentials (`init --from-eas`)

| Code | Exit | Meaning | Fix |
|---|---|---|---|
| `EAS_CREDENTIALS_NOT_FOUND` | 2 | No `credentials.json` at the path | Run `npx eas-cli credentials -p <ios\|android>`; iOS: answer n to "Do you want to log in to your Apple account?"; choose "credentials.json: Upload/Download credentials between EAS servers and your local json", then "Download credentials from EAS to credentials.json". In a terminal `init --from-eas` offers to run it for you |
| `EAS_CREDENTIALS_INVALID` | 1 | The file is not valid JSON, lacks a required field, has no section for the requested platform, or `--platform` asked for a platform it does not contain | Download it again with `eas credentials`; do not edit it by hand |
| `EAS_KEYSTORE_INVALID` | 1 | The keystore file is missing, `keytool` cannot open it with the stored password, the key alias does not exist, or the key password is wrong | Download the credentials again; the keystore and `credentials.json` must come from the same download |
| `EAS_KEYSTORE_EXISTS` | 1 | A different keystore is already at `~/.config/rn-shipyard/<slug>/release.keystore` and was not overwritten (non-interactive, or you answered no) | Move it yourself (it may be your only copy), or run in a terminal to be asked; a replaced file is kept as `.bak-<time>` |
| `EAS_IOS_EXTRACT_FAILED` | 1 | `openssl` could not read the distribution certificate with its password, is not installed, or a certificate or profile file is missing | Download the credentials again; make sure `openssl` is on `PATH` |
| `EAS_IOS_IMPORT_FAILED` | 1 | `fastlane match import` failed (git access, Apple login, `MATCH_PASSWORD`, certificate not found in your developer account), or the Fastfile lacks the import lane | Fix the problem in the output and re-run (the import is safe to repeat); run `init` without `--non-interactive`, or set an App Store Connect API key |

`MISSING_CONFIG_IOS` also exits `2` here when `MATCH_PASSWORD` (and no Match passphrase in the macOS keychain), `MATCH_GIT_URL` or `APPLE_TEAM_ID` is missing in non-interactive mode.

## Android

| Code | Exit | Meaning | Fix |
|---|---|---|---|
| `KEYSTORE_NOT_FOUND` | 2 from `init`, else 1 | Keystore file missing | Check the `--android-keystore` path, or `keystorePath` in `.shipyard/config.json` |
| `CREDENTIALS_NOT_READABLE` | 2 from `init`, else 1 | Cannot read the credentials file | Check `--android-credentials` or `credentialsPath` (JSON with `keystorePassword`, `keyAlias`, `keyPassword`) |
| `INVALID_KEYSTORE_PASSWORD` | 1 | Password shorter than 6 characters, or entered differently twice | Use 6 or more characters, entered identically twice |
| `KEYTOOL_NOT_FOUND` | 1 | `keytool` is not on `PATH` | Install a JDK (`brew install openjdk`) and make sure `keytool` is on `PATH` |
| `KEYSTORE_GENERATION_FAILED` | 1 | `keytool` failed | Check the keytool message (passwords need 6+ characters), or pass `--android-keystore` |
| `SHELL_DROPS_DOTTED_ENV` | 1 | `/bin/sh` drops variables with dots in their name | Restore `/bin/sh` to the system default |
| `GRADLE_FILE_NOT_FOUND` | 1 | A Gradle file is missing | Run `npx expo prebuild --platform android` first |
| `VERSION_CODE_PATCH_FAILED` | 1 | `versionCode N` not found in `android/app/build.gradle` | Open an issue: the generated Gradle template changed |
| `AAB_NOT_FOUND` | 1 | Gradle succeeded but no `.aab` was found | Check the Gradle output above |
| `INVALID_VERSION_CODE` | 1 | `--version-code` is not a positive integer | Pass a positive integer |
| `VERSION_CODE_REUSED` | 1 | `--version-code` is not greater than the last used one | Use a larger value, or omit `--version-code` |
| `INVALID_BUILD_NUMBER` | 1 | `--build-number` is not a positive integer | Pass a positive integer |
| `BUILD_NUMBER_REUSED` | 1 | `--build-number` is not greater than the last used iOS build number | Use a larger value, or omit `--build-number` |
| `FASTFILE_OUTDATED` | 1 | `fastlane/Fastfile` was generated by an older rn-shipyard and its iOS build lane has no signing or build-number step | Run `rn-shipyard init` again to regenerate it |

## Build and submit

| Code | Exit | Meaning | Fix |
|---|---|---|---|
| `PREBUILD_FAILED` | 1 | `expo prebuild --clean` failed | Run `npx expo prebuild --clean` yourself and fix the error |
| `NATIVE_DIR_UNTRACKED` | 1 | `ios/` or `android/` exists, is not committed and not ignored | Commit it, add it to `.gitignore`, or delete it |
| `NATIVE_DIR_NOT_IN_GIT` | 1 | `ios/` or `android/` exists but the project is not under git | Delete the folder, or put the project under git |
| `SECRET_IN_NATIVE_DIR` | 1 | A keystore or credentials file sits inside a folder prebuild would delete | Move it to `.shipyard/android/` or outside the project |
| `NO_ARTIFACTS` | 1 | No build artifacts in history | Run `rn-shipyard build` first |
| `SUBMIT_FAILED` | 1 | `build --submit` got no submit result | Run `rn-shipyard submit` on its own |

## Runtime

| Code | Exit | Meaning | Fix |
|---|---|---|---|
| `INPUT_CLOSED` | 1 | Input ended before all prompts were answered | Run in a terminal, or pass `--non-interactive` and provide values through environment variables |
| `INTERRUPTED` | 130 | Ctrl-C (`143` for SIGTERM, `129` for SIGHUP) | Run the command again |
| `INIT_FAILED` | 1 | `init` failed for another reason | Re-run with the same flags; if it persists, open an issue with the message |
| `UNEXPECTED_ERROR` | 1 | An unhandled error | Run the command again; if it persists, open an issue with the message |

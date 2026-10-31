---
title: Environment variables
description: Every environment variable rn-shipyard reads, what it is for, and which ones are redacted.
---

Secrets belong in the environment, not in files in your repo. Variables marked "redacted" are replaced with `***` in all output.

## Signing and submit

| Variable | Used for | Redacted |
|---|---|---|
| `MATCH_GIT_URL` | Match repo URL (iOS signing, `init`). Must not contain credentials | password or token inside the URL, if any |
| `MATCH_PASSWORD` | Match encryption password. CI sets it. Locally it is optional: when unset, fastlane match (and rn-shipyard's checks) use the macOS keychain item `match_<git url>`, which `init` can save for you | yes |
| `APPLE_TEAM_ID` | Apple Developer Team ID | no |
| `MATCH_GIT_BASIC_AUTHORIZATION` | base64 of `user:token` for an HTTPS Match repo | yes, and the decoded value |
| `MATCH_GIT_BEARER_AUTHORIZATION` | Bearer token for the Match repo | yes |
| `MATCH_KEYCHAIN_PASSWORD` | Keychain password for Match | yes |
| `MATCH_GIT_PRIVATE_KEY` | Private key for the Match repo | yes |
| `APP_STORE_CONNECT_API_KEY_KEY_ID` | App Store Connect API key ID | no |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | App Store Connect issuer ID | no |
| `APP_STORE_CONNECT_API_KEY_KEY` | API key contents (the `.p8` text) | yes |
| `APP_STORE_CONNECT_API_KEY_KEY_FILEPATH` | Path to the `.p8` file | no |
| `FASTLANE_USER` | Apple ID for submit | no |
| `FASTLANE_PASSWORD` | Apple ID password | yes |
| `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` | App-specific password | yes |
| `FASTLANE_SESSION` | Fastlane session cookie | yes |
| `ANDROID_KEYSTORE_PASSWORD` | Android keystore password | yes |
| `ANDROID_KEY_PASSWORD` | Android key password (defaults to the keystore password) | yes |
| `SUPPLY_JSON_KEY` | Path to the Google Play service account JSON (overrides `eas.json`) | no |
| `SUPPLY_JSON_KEY_DATA` | Service account JSON contents | yes |

## Output

| Variable | Effect |
|---|---|
| `NO_COLOR` | Any value turns colour off. Output is also plain when stdout is not a terminal (piped, redirected), including the `history` table. `FORCE_COLOR` turns it on |

## EAS aliases

These EAS names are accepted by `doctor`, `init`, `build` and `submit`. rn-shipyard copies each one that is set onto the Fastlane name for all child processes. If the Fastlane name is also set (non-empty), the Fastlane name wins. `EXPO_APPLE_PASSWORD` and `EXPO_APPLE_APP_SPECIFIC_PASSWORD` are redacted like their Fastlane counterparts.

`EXPO_APPLE_TEAM_ID` becomes `FASTLANE_TEAM_ID`, which Fastlane reads. The default Team ID that `init` offers still comes from `eas.json` (`appleTeamId`) or `APPLE_TEAM_ID`.

| EAS name | Fastlane name |
|---|---|
| `EXPO_APPLE_ID` | `FASTLANE_USER` |
| `EXPO_APPLE_PASSWORD` | `FASTLANE_PASSWORD` |
| `EXPO_APPLE_APP_SPECIFIC_PASSWORD` | `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` |
| `EXPO_APPLE_TEAM_ID` | `FASTLANE_TEAM_ID` |
| `EXPO_ASC_API_KEY_PATH` | `APP_STORE_CONNECT_API_KEY_KEY_FILEPATH` |
| `EXPO_ASC_KEY_ID` | `APP_STORE_CONNECT_API_KEY_KEY_ID` |
| `EXPO_ASC_ISSUER_ID` | `APP_STORE_CONNECT_API_KEY_ISSUER_ID` |

The three `*_ASC_*` / `APP_STORE_CONNECT_API_KEY_*` names also let `build` read the latest TestFlight build number for the iOS [build number counter](/guides/version-numbers/#ios-the-build-number-counter). `build` also reads them from `eas.json` `submit.<profile>.ios` (`ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId`).

## CI and interactive mode

rn-shipyard prompts only when stdin and stdout are both a terminal and none of `--json`, `--non-interactive` or `CI` is set. If `CI` is set to anything except `0` or `false`, it behaves as if `--non-interactive` was passed, so a CI runner with a pseudo-terminal never waits on a prompt.

## Set by rn-shipyard for child processes

Every piped child process (`expo prebuild`, `npx expo config`, `fastlane`, the build and submit lanes, non-interactive `git` and `fastlane match`) gets no stdin and these variables. This is the case in interactive runs too. Only the steps that run on your own terminal (see [CI and scripting](/guides/ci-scripting/#two-phases)) are left alone.

| Variable | Value |
|---|---|
| `CI` | `1` |
| `FASTLANE_IS_INTERACTIVE` | `false` |
| `SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA` | `true` |
| `GIT_TERMINAL_PROMPT` | `0` |
| `GIT_ASKPASS`, `SSH_ASKPASS` | `true` |
| `SSH_ASKPASS_REQUIRE` | `never` |
| `GCM_INTERACTIVE` | `never` |

The non-interactive Match clone and `init`'s non-interactive `fastlane match` also run with `ssh -o BatchMode=yes` and a connect timeout, detached from the terminal.

For the iOS build lane rn-shipyard also sets `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>` so that git reads your Match repo URL from the local clone (`url.<clone>.insteadOf`). Match keeps your real URL, so the passphrase it stored in the keychain is still found. Pairs already set in your shell are kept; the new one is appended after them.

Android signing passwords reach Gradle as `ORG_GRADLE_PROJECT_android.injected.signing.*`. These are set for the child process only.

## Build profile env and .env

The `env` of the selected `eas.json` build profile (including `extends`) is applied to config evaluation, prebuild and Fastlane. `.env` is loaded the way `expo prebuild` loads it. See [Dynamic config](/guides/dynamic-config/).

A profile cannot set the names rn-shipyard owns. These are ignored with a warning:

- every variable marked redacted above, plus `EXPO_APPLE_PASSWORD`, `EXPO_APPLE_APP_SPECIFIC_PASSWORD`, `ORG_GRADLE_PROJECT_android.injected.signing.store.password` and `ORG_GRADLE_PROJECT_android.injected.signing.key.password`
- `MATCH_GIT_URL`
- any name starting with `SHIPYARD_`
- `GIT_CONFIG_COUNT`, `GIT_CONFIG_PARAMETERS`, anything starting with `GIT_CONFIG_KEY_` or `GIT_CONFIG_VALUE_` (the git redirect to the local Match clone is built from them)
- the variables in "Set by rn-shipyard for child processes" (`CI`, `FASTLANE_IS_INTERACTIVE`, `SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA`, `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`, `SSH_ASKPASS`, `SSH_ASKPASS_REQUIRE`, `GCM_INTERACTIVE`)
- any name starting with `ORG_GRADLE_PROJECT_android.injected.signing.`

These names are applied but warned about, because they change how tools run: `PATH`, `NODE_OPTIONS`, `RUBYOPT`, `GIT_SSH_COMMAND`, `BUNDLE_GEMFILE` and anything starting with `DYLD_`. Values must be strings, numbers or booleans (numbers and booleans are converted); other values are dropped with a warning.

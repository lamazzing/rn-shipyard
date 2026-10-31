<div align="center">

<img src=".github/assets/logo.svg" alt="rn-shipyard logo" width="96" height="96">

# rn-shipyard

**Skip the EAS queue.** Build and submit your Expo app from your own Mac. No queue, no subscription, no Expo account.

[![npm](https://img.shields.io/npm/v/rn-shipyard)](https://www.npmjs.com/package/rn-shipyard)
[![CI](https://github.com/lamazzing/rn-shipyard/actions/workflows/ci.yml/badge.svg)](https://github.com/lamazzing/rn-shipyard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey)
![Node >=22.12](https://img.shields.io/badge/node-%3E%3D22.12-339933)

[Docs](https://lamazzing.github.io/rn-shipyard/) · [Quickstart](#quickstart) · [Discussions](https://github.com/lamazzing/rn-shipyard/discussions)

</div>

## Why

On EAS's free plan, cloud builds can wait in a shared queue, and priority comes with a paid plan ([pricing](https://expo.dev/pricing)). rn-shipyard builds start the moment you hit enter, on your own Mac, using [Fastlane](https://fastlane.tools) under the hood. It reads your existing `eas.json` and `app.json` / `app.config.js` and never modifies them.

**60-second quickstart**, from the root of your Expo project:

```bash
npx rn-shipyard doctor                                    # 1. check your Mac, get copy-paste fixes
npx rn-shipyard init --platform all                       # 2. one-time setup
npx rn-shipyard build --platform all --profile production # 3. build, output streams live
npx rn-shipyard submit --platform all                     # 4. upload to App Store Connect / Google Play
```

<details>
<summary>What <code>doctor</code> prints</summary>

```text
  rn-shipyard doctor

  ✓ System (6 checks passed)

  ✓ iOS (4 checks passed)

  Android
    ✓ JDK 17+  25.0.1
    ✓ JAVA_HOME  not set; Gradle uses java from PATH (25.0.1)
    ✓ ANDROID_HOME points to the Android SDK  ~/Library/Android/sdk
    ✓ SDK platform-tools and build-tools  build-tools 37.0.0
    ✓ keytool  available
    ✓ /bin/sh keeps env vars with dots  needed to pass signing passwords to Gradle

  Project
    ✓ Expo project (package.json depends on expo)  expo ~54.0.0
    ! No plaintext EAS credentials left over  a build has worked, but these still hold your signing keys/passwords in plaintext: credentials.json (git-ignored), credentials/ (git-ignored)
        Fix:  Once your signing is safely in Match / ~/.config/rn-shipyard (rn-shipyard never deletes these): rm -r -- credentials.json credentials/

  ✓ Signing & submit (4 checks passed)

  Ready:      iOS build, Android build, Android submit
  Not ready:  iOS submit (no .ipa yet: run `rn-shipyard build --platform ios`)

  Next step: Nothing blocks you (1 warning above). Run `rn-shipyard build`.
```

</details>

<p align="center"><img src=".github/assets/demo.gif" alt="rn-shipyard doctor, a signed Android build, and build history in a terminal" width="900"></p>

## Features

- **No queue.** Builds start immediately on your machine. Native output streams to your terminal in real time.
- **Submit from your Mac.** `.ipa` to App Store Connect (`pilot`) and `.aab` to Google Play (`supply`), no cloud hop.
- **Credentials you own.** Fastlane Match for iOS, your own keystore for Android. Nothing is held for you.
- **A Fastfile you can read.** `init` generates plain `fastlane/Fastfile`, `Appfile` and `Matchfile`. Commit them, edit them, understand them.
- **`doctor` tells you what is missing.** Every problem comes with the command that fixes it.
- **Safe by default.** Secrets are redacted from output and logs, committed `ios/` and `android/` folders are never overwritten, `--json` and exit codes make it scriptable.

## How it compares

✓ means good for you.

| | EAS Build (cloud) | `eas build --local` | rn-shipyard |
|---|---|---|---|
| Queue | Shared queue on the free plan; priority is a paid feature | ✓ None | ✓ None |
| Expo account needed | Yes | Yes (login and a linked EAS project) | ✓ No |
| Where submit runs | `eas submit` runs on Expo's servers | `eas submit` runs on Expo's servers | ✓ Your Mac, via Fastlane |
| Credentials | Managed by Expo (you can download them) | Managed by Expo | ✓ Yours: Match repo, your keystore |
| Cost | Free tier plus paid plans, see [pricing](https://expo.dev/pricing) | Free | ✓ Free, MIT |
| Needs a Mac for iOS | ✓ No | Yes | Yes |
| Windows / Linux | ✓ Yes | See Expo's docs | ✗ macOS only |
| OTA updates | ✓ EAS Update | ✓ EAS Update | No |
| Maturity | ✓ Established | Marked experimental in eas-cli 18.1.0 | New project |

If you need cloud builds, iOS builds without a Mac, or OTA updates, use EAS. If you have a Mac and want to skip the wait, use this.

> **Status:** Android and iOS are both verified end to end on a real Expo app (iOS: Expo → Match → TestFlight upload with an App Store Connect API key, using credentials imported with `init --from-eas`). It is still a new project, so if something breaks on your setup, please [open an issue](https://github.com/lamazzing/rn-shipyard/issues).

## Prerequisites

**Run `npx rn-shipyard doctor` first.** It checks everything below and prints the fix for each gap.

| Tool | Needed for | Notes |
|---|---|---|
| macOS 13+ | everything | the package declares `os: darwin` |
| Node.js >= 22.12, git | runtime, Match | `brew install node` |
| Ruby >= 2.7, Fastlane | build + submit | `brew install fastlane`; the Homebrew build brings its own Ruby |
| Xcode (selected with `xcode-select`, license accepted), CocoaPods | iOS | Mac App Store, then `sudo xcodebuild -license accept`; `brew install cocoapods` |
| JDK 17+ with `JAVA_HOME`, Android SDK (`ANDROID_HOME`, platform-tools, build-tools), `keytool` | Android | `brew install --cask zulu@17`; Android Studio installs the SDK |
| An Expo project with dependencies installed, `app.json`/`app.config.*`, `eas.json` | everything | run from the project root |

More: [Requirements](https://lamazzing.github.io/rn-shipyard/getting-started/requirements/)

## Install

```bash
npm install -g rn-shipyard
# or run without installing
npx rn-shipyard doctor
```

More: [Install](https://lamazzing.github.io/rn-shipyard/getting-started/install/)

## Quickstart

From the root of your Expo project:

```bash
rn-shipyard doctor                                     # 1. check the environment
rn-shipyard init --platform all                        # 2. one-time setup
rn-shipyard build --platform all --profile production  # 3. build
rn-shipyard submit --platform all                      # 4. upload
rn-shipyard history                                    # 5. review
```

`rn-shipyard build --submit` builds and then submits in one step (only if no platform failed).

More: [First build](https://lamazzing.github.io/rn-shipyard/getting-started/first-build/) · [First submission](https://lamazzing.github.io/rn-shipyard/getting-started/first-submission/)

## Migrating from EAS

`init` reads these values and never writes to `eas.json`, `app.json` or `app.config.js`:

- `eas.json`: `build` profiles (`--profile`), and `submit.<profile>`: `ios.appleId`, `ios.appleTeamId`, `android.serviceAccountKeyPath`, `android.track`, `android.releaseStatus`.
- `app.json`: `expo.name`, `expo.slug`, `expo.version`, `expo.ios.bundleIdentifier`, `expo.ios.buildNumber`, `expo.android.package`, `expo.android.versionCode`.
- A dynamic config (`app.config.ts`, `.js`, `.mjs`, `.cjs`) is evaluated the way EAS CLI does it, with `npx expo config --json` (the `expo` package must be installed, so run `npm install` first). It takes precedence over `app.json`, and `.env` files load as `expo prebuild` loads them.
- `eas.json` `build.<profile>.env` (with `extends` resolved) is applied when the config is evaluated and set in the environment of `expo prebuild` and the Fastlane builds. Secret variables rn-shipyard manages itself are never taken from the profile, and a warning names them.
- When a value such as `ios.bundleIdentifier` is missing from a dynamic config, rn-shipyard shows the snippet to add yourself. A config that fails to evaluate stops with `APP_CONFIG_EVAL_FAILED`.

To keep the Android upload key Expo holds for you, download it (`eas credentials`) and pass it in:

```bash
rn-shipyard init --platform android \
  --android-keystore ~/secrets/myapp-upload.jks \
  --android-credentials ~/secrets/myapp-credentials.json \
  --android-last-version-code 42      # the highest versionCode you already shipped
```

`--android-last-version-code` seeds the counter so rn-shipyard never reuses a code you already shipped.

**Import your EAS signing credentials in one step** (no new iOS certificate, same Android upload key). In a terminal, `init --from-eas` offers to run `npx eas-cli credentials -p <platform>` for you and prints the answers first (there is no non-interactive download in eas-cli): answer **n** to "Do you want to log in to your Apple account?" (the download only reads Expo's servers), choose "credentials.json: Upload/Download credentials between EAS servers and your local json", then "Download credentials from EAS to credentials.json", then Go back and Exit. Or do it yourself first, then:

```bash
rn-shipyard init --from-eas          # reads ./credentials.json; or --from-eas path/to/credentials.json
```

Android: the keystore is verified with `keytool`, copied to `~/.config/rn-shipyard/<slug>/` (folder `700`, files `600`) and wired into `.shipyard/config.json`. Compare the printed SHA-256 with Play Console > App integrity > Upload key certificate. iOS: the distribution certificate and provisioning profile(s) are converted in a private temp folder and imported into your Match repo with `fastlane match import` (it commits and pushes, needs `MATCH_GIT_URL`, `APPLE_TEAM_ID`, `MATCH_PASSWORD` and an Apple login). App-extension profiles are imported too, but `build` only fetches the main bundle ID's profile (known limitation). When a build works, delete `credentials.json` and `credentials/` yourself: they hold your passwords in plain text. rn-shipyard never deletes them. If the keystore or `.p12` was ever pushed or shared, request an upload-key reset in Play Console, revoke the distribution certificate in the Apple Developer portal and purge it from git history (new passwords do not help once the key file is public). During the import the plaintext key exists only in a private temp folder (as in fastlane's own flow); a hard kill (SIGKILL) can leave it in your `$TMPDIR`.

More: [Migrating from EAS](https://lamazzing.github.io/rn-shipyard/guides/migrating-from-eas/) · [Dynamic config](https://lamazzing.github.io/rn-shipyard/guides/dynamic-config/)

## Commands

Every command accepts `--json` and `--non-interactive`.

### `doctor`

| Flag | Description |
|---|---|
| `-p, --platform <ios\|android\|all>` | Which platform to check (default `all`) |

A requirements check that tells you what is missing and what to type to fix it. Checks run in parallel with timeouts, so it never hangs. Groups: **System**, **iOS**, **Android**, **Project**, and **Signing & submit** for the platforms you configured. It only reports whether a secret is set, never its value.

Each result is `✓` (fine), `!` (warning, will not stop a build) or `✗` (blocks the build or submit listed under "Not ready"). A platform that is not in `.shipyard/config.json` is "not set up" (with `rn-shipyard init --platform <p>` as the next step), and a submit counts as ready only when a successful build in history still has its `.ipa`/`.aab` on disk; otherwise it says `no .ipa yet: run rn-shipyard build --platform ios`. `doctor` also warns (never fails, never deletes) when EAS's plaintext `credentials.json` / `credentials/` are still on disk after a successful build, with the exact `rm` command and whether they are git-ignored. JAVA_HOME may be unset when the `java` on PATH is JDK 17+: Gradle's wrapper uses `$JAVA_HOME/bin/java` if set and `java` from PATH otherwise. The summary is per action: iOS build, iOS submit, Android build, Android submit. Exit `0` when nothing failed, `2` when only project setup is missing (run `init`), `1` otherwise.

### `init`

| Flag | Description |
|---|---|
| `-p, --platform <ios\|android\|all>` | Platform to set up (default `all`) |
| `--android-keystore <path>` | Use an existing keystore instead of generating one |
| `--android-credentials <path>` | JSON file with keystore password, alias, key password (keep outside the repo) |
| `--android-last-version-code <n>` | Seed the versionCode counter |

Interactive (readline prompts) in a terminal. With `--non-interactive`, `--json` or a non-TTY stdin it never prompts: values come from environment variables and your Expo config, and a missing value exits `2`. Password prompts never echo.

- **One platform at a time is safe:** `init --platform ios` merges into an existing `.shipyard/config.json` (the Android block, `version-code.json` and `history.json` stay untouched) and regenerates `fastlane/` for every configured platform. Re-running it for the same platform replaces only that block; its defaults come from the existing config.
- **iOS:** asks for bundle identifier, Apple Team ID and Match Git URL (defaults from your config, `APPLE_TEAM_ID`, `MATCH_GIT_URL`). The Match password comes from `MATCH_PASSWORD` (CI) or from the macOS keychain item fastlane match itself reads (`match_<git url>`); in a terminal `init` offers to save it there (macOS asks for it, it never touches the command line). It then runs `fastlane match appstore`. With neither, it skips Match and the summary and `--json` (`setup.ios.status: "skipped"`) say so, with the next step.
- **App Store Connect key check:** when an API key is configured (`APP_STORE_CONNECT_API_KEY_*` / `EXPO_ASC_*` / `ascApiKey*` in `eas.json`), `init` makes one read-only call to App Store Connect (`GET /v1/apps?filter[bundleId]=...`) with a short-lived JWT. A wrong key fails with `ASC_KEY_INVALID` (401); a role that is too low (403, submit needs App Manager or Admin), a missing app record or no network is only a warning, since building does not need the key.
- **Match URL:** it is committed in `.shipyard/config.json` and `fastlane/Matchfile`, so it must not contain credentials. `https://x-access-token:TOKEN@github.com/...` is rejected (`INVALID_MATCH_GIT_URL`). Use `git@github.com:org/certs.git`, or a plain `https://` URL plus `MATCH_GIT_BASIC_AUTHORIZATION`.
- **Android:** generates `.shipyard/android/release.keystore` with `keytool`, or adopts the keystore you pass.
- Writes `.shipyard/config.json`, `fastlane/Fastfile`, `Appfile` (and `Matchfile`), and appends keystore and artifact patterns to your `.gitignore`.

Error codes are listed in the [error reference](https://lamazzing.github.io/rn-shipyard/reference/error-codes/).

### `build`

| Flag | Description |
|---|---|
| `-p, --platform <ios\|android\|all>` | Platform to build (default `all`) |
| `--profile <name>` | Build profile from `eas.json` (default `production`) |
| `--submit` | Submit after a successful build |
| `--version-code <n>` | Android versionCode, must be greater than the last used one |
| `--build-number <n>` | iOS build number (`CFBundleVersion`), must be greater than the last used one |
| `--skip-version-check` | Skip the "version looks unchanged" warning |
| `--skip-checks` | Skip the `doctor` pre-flight |

Per platform, `build` decides whether `npx expo prebuild --clean` may run:

| `ios/` or `android/` | What happens |
|---|---|
| tracked in git | prebuild **skipped**, the committed project is built as is |
| missing | generated with `expo prebuild` |
| present and git-ignored | regenerated with `expo prebuild --clean` |
| present, untracked, not ignored | **refused** (`NATIVE_DIR_UNTRACKED`): `--clean` would delete work git cannot restore |
| project is not a git repo | **refused** (`NATIVE_DIR_NOT_IN_GIT`) |

iOS and Android build one after the other and independently: if iOS fails, Android still runs. Artifacts go to `output/`, and every run is appended to `.shipyard/history.json`. `package.json` and lockfiles are restored if prebuild rewrote them, also on Ctrl-C, SIGTERM or a closed terminal (exit `130` / `143` / `129`).

**Two phases, like EAS.** Anything that may prompt (cloning the Match repo, the Apple login) runs first on your real terminal. The build or upload itself then runs with no stdin, `CI=1` and redacted output, so a tool that wants to prompt fails immediately instead of hanging. With `--non-interactive`, `--json` or no TTY there is no first phase: the Match repo is cloned with prompts disabled and fails fast with `MATCH_REPO_AUTH_FAILED` if git needs one.

**Android versionCode.** The code is the larger of `expo.android.versionCode` (1 if unset) and `lastUsed + 1`, where `lastUsed` comes from `.shipyard/version-code.json` and your build history. It is applied to the generated Gradle project, never written to `app.json`, and the counter advances only after a successful build. A committed `android/app/build.gradle` is never edited: its literal `versionCode` is read and used, and if it cannot be read the build fails rather than guess.

**iOS signing.** After Match (read-only) and before the archive, the build lane applies manual signing to the **app target only** (not Pods, not app extensions) in the Xcode project: your Team ID from `.shipyard/config.json`, the provisioning profile and distribution certificate Match installed, and the bundle id; gym gets the matching `provisioningProfiles` export mapping. This fixes `Signing for <App> requires a development team` without putting `appleTeamId` in `app.json`. A generated `ios/` is simply rebuilt next time; a git-tracked `ios/` has `project.pbxproj` and `Info.plist` restored byte for byte afterwards, also on Ctrl-C. App extensions are not signed by rn-shipyard yet. A `fastlane/Fastfile` from an older rn-shipyard fails with `FASTFILE_OUTDATED`: run `rn-shipyard init` again.

**iOS build number.** The next number is the larger of `expo.ios.buildNumber` (integers only, 1 if unset) and `lastUsed + 1` (`.shipyard/version-code.json` `ios.lastUsed` and your build history). With an App Store Connect API key (`EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, `EXPO_ASC_API_KEY_PATH`, or `submit.<profile>.ios.ascApi*` in `eas.json`) the lane first reads the latest TestFlight build number and uses `max(local, latest + 1)`, like EAS remote versioning. Without a key it uses the local counter and prints one hint. The number is written to the generated app's `Info.plist` (`CFBundleVersion`), never to `app.json`, and the counter advances only after a successful build. Your marketing version is never touched.

**Failure summary.** The error shown (and stored in `--json` and history) is the real one: the xcodebuild or Gradle `error:` line, else fastlane's `[!]` line, else the last 15 lines. The Gemfile tip and update notices are ignored.

Exit `0` all platforms succeeded, `1` any failed, `2` not initialized.

More: [Commands reference](https://lamazzing.github.io/rn-shipyard/reference/commands/) · [Version numbers](https://lamazzing.github.io/rn-shipyard/guides/version-numbers/)

### `submit`

| Flag | Description |
|---|---|
| `-p, --platform <ios\|android\|all>` | Platform to submit (default `all`) |
| `--profile <name>` | Submit profile from `eas.json` (default `production`) |
| `--dry-run` | Check everything and print the fastlane command, upload nothing |
| `--skip-checks` | Skip the `doctor` pre-flight |

Uploads the latest successful build of each platform in history. Track and release status come from `eas.json` (`submit.<profile>.android.track` and `releaseStatus`), defaulting to `internal` and `draft`. The Play service-account path comes from `SUPPLY_JSON_KEY`, then `eas.json`, then `.shipyard/config.json`; with none, Android is skipped with a message. Platforms submit independently.

`build`, `submit` and `init` first run the relevant `doctor` checks and stop with `REQUIREMENTS_NOT_MET` if something blocks the run. Warnings never block, and the pre-flight makes no network calls.

For iOS with an Apple ID in a terminal, `submit` offers to log in first. Fastlane asks for the password and 2FA code, stores the password in your macOS keychain and caches the session; the upload then runs without prompting. See [iOS credentials for submit](#ios-credentials-for-submit). Unsure what will happen? Run `submit --dry-run`.

Exit `0` all succeeded or skipped, `1` any failed or no artifacts, `2` not initialized or iOS credentials missing.

More: [App Store Connect](https://lamazzing.github.io/rn-shipyard/guides/submit-app-store/) · [Google Play](https://lamazzing.github.io/rn-shipyard/guides/submit-google-play/)

### `history`

| Flag | Description |
|---|---|
| `-p, --platform <ios\|android>` | Filter by platform |
| `-l, --limit <n>` | Entries to show (default `10`) |

Shows builds and submits from `.shipyard/history.json` as a table. The table is plain text (no colour codes) when stdout is not a terminal or `NO_COLOR` is set.

### Global flags

| Flag | Description |
|---|---|
| `--json` | Machine-readable output, see [JSON output](#json-output-and-exit-codes) |
| `--non-interactive` | Never prompt; fail with a clear error instead |
| `-V, --version` | Print the version |
| `-h, --help` | Help for a command |

## Signing setup

### iOS (Fastlane Match)

rn-shipyard uses Match with type `appstore`. You need a private Git repo to hold the encrypted certificates and profiles.

1. Create the private repo and export its URL: `export MATCH_GIT_URL=git@github.com:you/certs.git`.
2. Choose an encryption password and `export APPLE_TEAM_ID=...`. Locally, `init` offers to save the password in the macOS keychain (fastlane match reads it there, so no `MATCH_PASSWORD` in every shell); in CI export `MATCH_PASSWORD=...`.
3. Run `rn-shipyard init --platform ios`. It runs `fastlane match appstore` and writes the Matchfile. In a terminal, Match runs in the foreground, so Apple ID password, 2FA and git/ssh prompts work normally.
4. For `submit`, provide App Store Connect credentials, see below.

Each iOS `build` clones the Match repo itself first. Interactively that happens on your terminal, so ssh passphrases and credential helpers just work. In `--non-interactive` or `--json` mode nothing can prompt: load your key into ssh-agent (`ssh-add --apple-use-keychain ~/.ssh/id_ed25519`) or configure a git credential helper, otherwise the build fails with `MATCH_REPO_AUTH_FAILED`. Only git storage is supported.

More: [iOS signing](https://lamazzing.github.io/rn-shipyard/guides/ios-signing/)

#### iOS credentials for submit

Either of these is enough (the API key is checked first). The `EXPO_*` names are the ones EAS CLI uses; rn-shipyard accepts them as aliases. If both are set, the Fastlane name wins.

- **App Store Connect API key:** the key you configured for EAS in `eas.json` (`submit.<profile>.ios.ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId`) works as is. Or set `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID` and `EXPO_ASC_API_KEY_PATH` (the `.p8`), or the Fastlane names `APP_STORE_CONNECT_API_KEY_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID` and `APP_STORE_CONNECT_API_KEY_KEY` / `_KEY_FILEPATH`. Best for CI: no login step.
- **Apple ID:** from `submit.<profile>.ios.appleId`, `EXPO_APPLE_ID` or `FASTLANE_USER`, plus one of:
  - nothing, in a terminal: `submit` asks to log in and Fastlane stores the password in the macOS keychain (`deliver.<apple id>`). `FASTLANE_DONT_STORE_PASSWORD` opts out;
  - an app-specific password (`EXPO_APPLE_APP_SPECIFIC_PASSWORD` / `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`, created at appleid.apple.com) or `EXPO_APPLE_PASSWORD` / `FASTLANE_PASSWORD`;
  - a password stored earlier with `fastlane fastlane-credentials add --username <apple id>`.

With no usable credential in non-interactive mode, `submit` fails with `MISSING_CONFIG_IOS_CREDENTIALS` (exit `2`) and the fix names the variables. A 2FA code can only be typed in a terminal; for unattended runs use an API key.

### Android (keystore + credentials file)

The keystore is `.shipyard/android/release.keystore` (generated by `init`) or one you adopt with `--android-keystore`. Passwords come from, in order:

1. `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD` (the key password defaults to the keystore password).
2. The credentials file at `credentialsPath` in `.shipyard/config.json` (or passed to `init --android-credentials`). Keep it outside the repo; `init` warns if it sits inside and is not git-ignored.

Credentials file (the values are fake):

```json
{
  "keystorePassword": "example-store-password",
  "keyAlias": "upload",
  "keyPassword": "example-key-password",
  "keystorePath": "./upload.jks"
}
```

`keystorePassword` and `keyAlias` are required (the password may come from `ANDROID_KEYSTORE_PASSWORD` instead). `keyPassword` defaults to the keystore password. A relative `keystorePath` resolves against the credentials file's directory.

For Google Play uploads, create a service account in Google Cloud, grant it access in Play Console, and point to its JSON key with `SUPPLY_JSON_KEY` or `eas.json`. Back up your release keystore: losing the upload key means a support request to Google.

More: [Android credentials](https://lamazzing.github.io/rn-shipyard/guides/android-credentials/)

## Environment variables

| Variable | Used for |
|---|---|
| `MATCH_PASSWORD`, `MATCH_GIT_URL`, `APPLE_TEAM_ID` | iOS signing (`init`). `MATCH_PASSWORD` is optional locally: the macOS keychain item `match_<git url>` is used when it is unset |
| `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, `EXPO_ASC_API_KEY_PATH` | iOS submit (API key), EAS names; alias of the next row |
| `APP_STORE_CONNECT_API_KEY_KEY_ID`, `_ISSUER_ID`, `_KEY` or `_KEY_FILEPATH` | iOS submit (API key), Fastlane names |
| `EXPO_APPLE_ID`, `EXPO_APPLE_PASSWORD`, `EXPO_APPLE_APP_SPECIFIC_PASSWORD`, `EXPO_APPLE_TEAM_ID` | iOS submit / signing (Apple ID), EAS names; aliases of `FASTLANE_USER`, `FASTLANE_PASSWORD`, `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`, `FASTLANE_TEAM_ID` |
| `FASTLANE_USER`, `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` or `FASTLANE_PASSWORD` | iOS submit (Apple ID), Fastlane names; win over the `EXPO_*` aliases |
| `GIT_SSH_COMMAND` | Base ssh command for the non-interactive Match clone |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` | Android signing; override the credentials file |
| `SUPPLY_JSON_KEY` | Path to the Google Play service-account JSON (overrides `eas.json`) |
| `NO_COLOR`, `FORCE_COLOR` | Turn colour off / on. Output is plain when stdout is not a terminal |

rn-shipyard does not load `.env` files itself. Export the variables in your shell (for example `set -a; source .env; set +a`).

More: [Environment variables](https://lamazzing.github.io/rn-shipyard/reference/environment-variables/)

## Security

- **Secrets stay in the environment.** Passwords come from environment variables or an Android credentials file outside your repo. They are never written to `.shipyard/config.json`, `history.json` or the generated Fastlane files, and never appear on a process command line.
- **Redaction.** All piped output (build and submit lanes, `expo prebuild`, `doctor` probes, the non-interactive Match clone) has known secrets replaced with `***`, including escaped and encoded forms, in the terminal, in `--json` results and in history. Steps that run on your own terminal (Apple login, interactive Match clone) are not captured or logged at all. Secrets inside files Fastlane reads itself, such as a service-account JSON, are not scanned for, so review logs before pasting them into public issues.
- **Android signing preflight.** Before an Android build, rn-shipyard checks that `/bin/sh` keeps environment variables with dots in their name, using a dummy value, and fails with `SHELL_DROPS_DOTTED_ENV` if not.

What to commit:

| Path | Commit? |
|---|---|
| `.shipyard/config.json`, `.shipyard/.gitignore`, `.shipyard/version-code.json` (Android and iOS counters) | Yes |
| `fastlane/Fastfile`, `Appfile`, `Matchfile` | Yes |
| `.shipyard/history.json`, `output/` (`.ipa`, `.aab`) | No (ignored) |
| `.shipyard/android/*.keystore`, `*.jks` | No, never (ignored) |
| Credentials JSON, service-account JSON, `.p8`/`.p12`, `.env` | No, keep outside the repo |

Report vulnerabilities privately, see [SECURITY.md](./SECURITY.md).

More: [Security](https://lamazzing.github.io/rn-shipyard/security/)

## JSON output and exit codes

With `--json`, every command prints one JSON object with a top-level `success` boolean:

```json
{ "success": true, "platforms": { "ios": { "status": "success", "version": "1.2.0", "artifactPath": "output/MyApp-1.2.0-12.ipa", "durationSeconds": 412, "error": null } } }
```

Errors:

```json
{
  "success": false,
  "error": {
    "code": "MISSING_CONFIG_SHIPYARD",
    "message": "Project not initialized. .shipyard/config.json not found.",
    "fix": "Run 'rn-shipyard init' to set up the project first"
  }
}
```

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (at least one platform or check failed) |
| `2` | Missing configuration (not initialized, or required values missing in `--non-interactive` mode) |

More: [JSON and exit codes](https://lamazzing.github.io/rn-shipyard/reference/json-and-exit-codes/) · [CI and scripting](https://lamazzing.github.io/rn-shipyard/guides/ci-scripting/)

## Troubleshooting

- **`doctor` fails on Ruby:** `brew install fastlane`. It brings its own Ruby and the system Ruby is then ignored.
- **`Project not initialized` (exit 2):** run `rn-shipyard init` in the project root.
- **Match setup skipped:** the summary says so. Set `MATCH_PASSWORD` (or run `init` in a terminal and save the password in the keychain) and re-run `init --platform ios`; it keeps your Android setup.
- **`VERSION_CODE_REUSED`:** pass a `--version-code` greater than the reported value, or omit the flag.
- **`BUILD_NUMBER_REUSED`:** pass a `--build-number` greater than the reported value, or omit the flag.
- **`FASTFILE_OUTDATED`:** your `fastlane/Fastfile` came from an older rn-shipyard (no iOS signing step). Run `rn-shipyard init` again.
- **`KEYSTORE_NOT_FOUND` / `CREDENTIALS_NOT_READABLE`:** check `keystorePath` and `credentialsPath` in `.shipyard/config.json`.
- **Android submit skipped:** no service account configured. Set `SUPPLY_JSON_KEY` or `submit.<profile>.android.serviceAccountKeyPath` in `eas.json`.
- **`MISSING_CONFIG_IOS_CREDENTIALS` (exit 2):** set an App Store Connect API key or an Apple ID plus password, or run `submit` in a terminal and log in when asked. See [iOS credentials for submit](#ios-credentials-for-submit).
- **`MATCH_REPO_AUTH_FAILED` (exit 1):** git could not read the Match repo. Check the key or token and the URL; for non-interactive runs load your key into ssh-agent or configure a credential helper.
- **`APPLE_LOGIN_FAILED` / no keychain password after login:** run `submit` again, or provide `EXPO_APPLE_PASSWORD` or an API key.
- **Apple login lane missing:** your `fastlane/Fastfile` came from an older rn-shipyard. Run `rn-shipyard init` again.
- **Reporting a bug:** include `rn-shipyard doctor --json` output with secrets and personal paths removed.

More: [Troubleshooting](https://lamazzing.github.io/rn-shipyard/troubleshooting/) · [FAQ](https://lamazzing.github.io/rn-shipyard/faq/)

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Before your first pull request can be merged you sign the [CLA](./CLA.md) by commenting on the PR. You keep the copyright in your work; the code stays MIT. Changes are listed in [CHANGELOG.md](./CHANGELOG.md).

## Roadmap

Out of scope on purpose: OTA updates, Windows and Linux, monorepos, custom Fastlane lanes, build caching, parallel platform builds, automatic version bumping.

Planned: **cloud builds with your own GitHub Actions**. `rn-shipyard build --cloud` would run the same build on GitHub's macOS runners, using your repository's Actions minutes, with no Mac and no Expo account needed.

Hosted builds without the queue are on the roadmap too, for people with no Mac or who want builds off their machine. Nothing hosted exists today. If you want it, [tell us in Discussions](https://github.com/lamazzing/rn-shipyard/discussions).

More: [Roadmap](https://lamazzing.github.io/rn-shipyard/roadmap/)

## License

[MIT](./LICENSE) (c) Luca Mazzi

rn-shipyard is an independent open-source project, not affiliated with or endorsed by Expo. Expo and EAS are trademarks of 650 Industries, Inc.

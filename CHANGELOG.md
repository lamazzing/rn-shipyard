# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- iOS archive no longer fails with `Signing for <App> requires a development team`. After Match (read-only) and before gym, the build lane applies manual signing to the app target only (Team ID from `.shipyard/config.json`, the provisioning profile and certificate name Match exports, the bundle id) and passes gym the matching `provisioningProfiles` export mapping. No `appleTeamId` in `app.json` needed. A git-tracked `ios/` has `project.pbxproj` and `Info.plist` restored byte for byte afterwards (also on Ctrl-C). App extensions are not signed yet.
- The failure summary shows the real error: the xcodebuild/gym or Gradle `error:` line, else fastlane's `[!]` line, else the last 15 non-empty lines, ignoring the Gemfile tip and update notices. It applies to the terminal summary, `--json` `error` and history, for iOS and Android.

### Added
- iOS build-number counter in `.shipyard/version-code.json` (`ios.lastUsed`), never reused. With an App Store Connect API key (`EXPO_ASC_*` or `eas.json` `submit.<profile>.ios.ascApi*`) the build lane reads the latest TestFlight build number and uses `max(local, latest + 1)`, like EAS remote versioning; without a key it uses the local counter and prints one hint. The number is set as `CFBundleVersion` in the generated `Info.plist` (never `app.json`) and recorded in history. New `build --build-number <n>` override; new error codes `INVALID_BUILD_NUMBER`, `BUILD_NUMBER_REUSED`, `FASTFILE_OUTDATED` (a Fastfile from an older rn-shipyard: run `rn-shipyard init` again).

## [0.2.1] - 2026-10-31

### Changed
- npm package metadata: homepage points to the docs site; more search keywords
  (eas-build, eas-submit, local-build, testflight, app-store, google-play, cli).

## [0.2.0] - 2026-10-30

### Added
- `init --from-eas [path]` imports the signing credentials `eas credentials` downloaded (`credentials.json`), so EAS users switch without new certificates or a new Android upload key. Android: the keystore is verified with `keytool` (alias and key password), copied to `~/.config/rn-shipyard/<slug>/` (folder `700`, files `600`), the SHA-256 upload-key fingerprint is printed, and `.shipyard/config.json` is configured like `--android-keystore` plus `--android-credentials`. iOS: the distribution certificate is converted with `openssl` in a private temp folder into a `.cer` and the private key as an unencrypted traditional RSA PEM (what match itself stores as its "p12"; macOS rejects OpenSSL 3+ PKCS#12 files), then imported into the Match repo with `fastlane match import` (new internal lane `shipyard_match_import`; commits and pushes), for every target's provisioning profile. Passwords travel in the environment only. The plaintext EAS files are never deleted: `init` warns when they are not git-ignored or are tracked, and prints the delete command for once a build works. New error codes `EAS_CREDENTIALS_NOT_FOUND` (exit 2), `EAS_CREDENTIALS_INVALID`, `EAS_KEYSTORE_INVALID`, `EAS_KEYSTORE_EXISTS`, `EAS_IOS_EXTRACT_FAILED`, `EAS_IOS_IMPORT_FAILED`.

## [0.1.1] - 2026-10-30

### Fixed
- `submit` and `doctor` read the App Store Connect API key from `eas.json`
  (`submit.<profile>.ios.ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId`), plus `appleTeamId` and
  `ascAppId`, as `eas submit` does. Environment variables still win. Previously an EAS project with its
  key in `eas.json` failed with `MISSING_CONFIG_IOS_CREDENTIALS`.

### Changed
- Requires Node.js >= 22.12 (Node.js 20 is end of life); commander 15, vitest 5.
- `doctor` prints the real `JAVA_HOME` path for a Homebrew JDK and shows credential paths project-relative.

## [0.1.0] - 2026-10-30

### Hardening
- Output redaction: a secret printed with a pause in the middle is masked in full (the held prefix is masked, and the continuation is matched against it), at any split point.
- `init` and `build` refuse an Android keystore or credentials file inside `ios/` or `android/` (`SECRET_IN_NATIVE_DIR`), which `expo prebuild --clean` would delete.
- Restoring `package.json` and lockfiles after prebuild is serialized between the normal path and the signal handler, and the synchronous exit fallback stays registered until the owner is done.
- Usage errors (unknown option, missing argument) print a `{success:false,error:{code:"INVALID_USAGE",...}}` envelope with `--json`.
- `--json` output is written synchronously to stdout, so large documents are not truncated by `process.exit`.

### Changed
- Two-phase model, like EAS CLI: everything that may prompt runs first on your real terminal, the build/submit runs fully non-interactive, piped and redacted. New `foreground` mode in the shell layer (stdio inherited, not detached, not captured, still tracked for signals); the half-way mode (stdin inherited with piped output, whose prompts went through the redactor and sometimes lost their last character to `***`) is removed. Piped children always get no stdin and `CI=1`, `FASTLANE_IS_INTERACTIVE=false`, `SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA=true`.
- iOS build clones the Match repo itself before the build lane (bare clone in a private temp dir, removed on success, failure and Ctrl-C): ssh passphrases, https credentials and credential helpers now work in a terminal. With `--non-interactive` the clone disables every prompt path (`GIT_TERMINAL_PROMPT=0`, askpass programs, Git Credential Manager, ssh `BatchMode`, 15 s connect timeout) and fails with the new `MATCH_REPO_AUTH_FAILED`. The generated Fastfile takes match's `git_url` from `SHIPYARD_MATCH_GIT_URL` when set.
- iOS submit with an Apple ID asks `Log in to your Apple account now? (Y/n)` in a terminal and logs in on it (internal `shipyard_apple_login` lane): Fastlane prompts for password and 2FA, stores the password in the keychain and caches the session; the piped upload reuses both. `init`'s `fastlane match` runs in the foreground in a terminal.
- EAS-compatible environment names accepted as aliases (Fastlane names win): `EXPO_APPLE_ID`, `EXPO_APPLE_PASSWORD`, `EXPO_APPLE_APP_SPECIFIC_PASSWORD`, `EXPO_APPLE_TEAM_ID`, `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`. The two password aliases are redacted.
- `MISSING_CONFIG_IOS_CREDENTIALS` fix text lists both the `EXPO_ASC_*` and `APP_STORE_CONNECT_API_KEY_*` names. New error codes: `MATCH_REPO_AUTH_FAILED`, `APPLE_LOGIN_FAILED`.

### Review fixes
- Ctrl-C at the "Log in to your Apple account now?" question aborts the run (exit 130, `INTERRUPTED` envelope in JSON) instead of counting as "no" and uploading; only closed input (`INPUT_CLOSED`) means no.
- `CI` set (not `0`/`false`) disables interactive mode, so pty-backed CI runners never wait on a prompt or a foreground clone.
- The Match pre-clone uses `git clone --bare -- <url>`, rejects URLs starting with `-` (`INVALID_MATCH_GIT_URL`), and shares the non-interactive git environment with `doctor` (`src/utils/git-env.ts`); the non-interactive https clone also aborts stalled transfers.
- Piped children always get `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS`/`SSH_ASKPASS=true`, `SSH_ASKPASS_REQUIRE=never` and `GCM_INTERACTIVE=never`, so init's piped `fastlane match` cannot prompt through `/dev/tty`.
- A failed iOS build reports `errorCode` (e.g. `MATCH_REPO_AUTH_FAILED`) in `--json` and the human line; `APPLE_LOGIN_FAILED` likewise in submit.
- Foreground children: the terminal state (`stty -g`) is restored after they exit or are killed, so a signal during a password read does not leave echo off.
- `build --submit` asks for the Apple login before the build starts.
- README and website: foreground steps are not redacted or logged; everything piped is.

- init's non-interactive `fastlane match` and the non-interactive Match clone now run detached (no controlling terminal) with ssh `BatchMode` and a connect timeout, so ssh cannot open `/dev/tty` for a host-key or passphrase prompt; the env vars alone were not enough.
- `stty` calls around foreground children have a 2 s timeout; the saved terminal state is also restored by the signal handler and the exit hook.
- `init` leaves out the `eas-json` check (it has its own "No eas.json found" path). `MISSING_CONFIG_IOS_CREDENTIALS` is reported as `errorCode` in the submit result.

### Added (requirements pre-flight)
- `build`, `submit` and `init` run the `doctor` requirement checks first (`REQUIREMENTS_NOT_MET` exit 1, `MISSING_CONFIG_PROJECT` exit 2, JSON envelope with `checks`; warnings never block; no network calls). `--skip-checks` on `build` and `submit` bypasses it. `init` skips the checks for what it creates.

### Fixed
- The iOS build lane no longer hands Match the local clone path as `git_url`, which made Match miss the keychain passphrase it stored for the real URL (`match_<git_url>`) and fail unless `MATCH_PASSWORD` was exported. Match keeps the real URL; git is redirected to the local clone with env-only config (`GIT_CONFIG_COUNT`/`_KEY_n`/`_VALUE_n`: `url.<clone>.insteadOf`), appended after any pairs already set. These variables are now reserved against build-profile `env`. `SHIPYARD_MATCH_GIT_URL` is gone.
- The generated `submit` lane now loads an App Store Connect API key from the `APP_STORE_CONNECT_API_KEY_*` variables (`app_store_connect_api_key`), which `pilot` does not read on its own.

### Added
- Dynamic Expo configs: `app.config.ts`, `.js`, `.mjs` and `.cjs` are evaluated with `npx expo config --json` (as EAS CLI does; `.env` is loaded like `expo prebuild` does) and take precedence over `app.json`. New error code `APP_CONFIG_EVAL_FAILED` (exit 1); an unparseable `app.json` is now `INVALID_APP_CONFIG` instead of `MISSING_CONFIG_APP`.
- `eas.json` `build.<profile>.env` (with `extends`) is applied when evaluating the config and in the environment of `expo prebuild` and the Fastlane builds. rn-shipyard's own secret variables are never overridden by it.
- Warnings and `init` messages name the actual config file; for a dynamic config they say it can't be edited automatically and show the snippet to add.
- `doctor` is now a requirements check for people new to local builds: grouped checks (System, iOS, Android, Project, Signing & submit), each with a one-line detail, the exact fix command and a README link, a per-action "Ready / Not ready" summary and a single next step. New checks: macOS version, git, Xcode command line tools, Xcode selected and license accepted, JDK 17+, `JAVA_HOME`, `ANDROID_HOME` with platform-tools and build-tools, Expo project and installed dependencies, `app.json`/`app.config.*`, `eas.json`, `.shipyard/config.json`, and (for the platforms you configured) Match password and certificates-repo reachability, App Store Connect login, Android keystore, credentials file and passwords, Google Play service-account key. Secrets are only reported as set or not set. Exit codes: `0` nothing failed, `2` only project setup is missing, `1` otherwise; `--json` adds `checks`, `readiness`, `summary` and `nextStep`.
- `runRequirementChecks({ projectDir, platforms, actions })` (`src/requirements`) runs the same checks for other commands, and `requirementsError()` turns failures into a `REQUIREMENTS_NOT_MET` error listing each fix.
- `doctor` accepts Homebrew Fastlane's bundled Ruby.
- `init`: reads `eas.json` and `app.json` (never modifies them), sets up iOS signing with Fastlane Match, generates or adopts an Android release keystore, writes `.shipyard/config.json` and generates `fastlane/Fastfile`, `Appfile` and `Matchfile`.
- `init` options for migrating from EAS: `--android-keystore`, `--android-credentials`, `--android-last-version-code`.
- `build`: runs `expo prebuild --clean`, then builds iOS and Android independently (a failure on one platform does not stop the other), writes artifacts to `output/` and records history. `--submit`, `--profile`, `--skip-version-check`, `--version-code`.
- Android `versionCode` counter that never reuses a code.
- `submit`: uploads the `.ipa` to App Store Connect and the `.aab` to Google Play, reading track and release status from `eas.json`. `--profile`, `--dry-run`.
- `submit --dry-run` validates iOS (artifact and App Store Connect credentials) and Android, and with `--json` reports `platforms.<ios|android>` entries with `status`, `artifactPath`, `command` and `problems`.
- Real `submit` runs the same iOS credentials check: a missing credential fails with `MISSING_CONFIG_IOS_CREDENTIALS` (exit 2) in every mode, interactive included, instead of continuing into Fastlane's "non-interactive shell" error (Fastlane cannot prompt for an Apple ID when its stdout is piped).
- `init` writes `.shipyard/.gitignore`; new error codes `INVALID_FLAGS` and `MISSING_CONFIG_ANDROID`; the Android credentials file accepts `keystorePassword`, `keyAlias`, optional `keyPassword` and optional `keystorePath`.
- `history`: local build and submit history as a table, with `--platform` and `--limit`.
- Global `--json` and `--non-interactive` flags on every command, with a stable JSON envelope and exit codes (0 success, 1 error, 2 missing config).
- Secret redaction in streamed and captured output, for every spawned process: Android signing passwords plus the iOS and Play secrets in the environment (`MATCH_*`, `FASTLANE_*`, `APP_STORE_CONNECT_API_KEY_KEY`, `SUPPLY_JSON_KEY_DATA`), collected centrally in `src/utils/secrets.ts`. Signing passwords are passed to Gradle and `keytool` through the environment, never on a command line.
- Paths in `.shipyard/config.json` and `history.json` are project-relative or `~/`-based.
- The generated `fastlane/Fastfile` contains no absolute machine path.
- `doctor` requires Node.js >= 22.12 (matches `engines`). Node.js 20 reached end of life in April 2026; commander 15 and vitest 5 need 22.12.
- `build` runs `expo prebuild --clean` only for a native folder that is absent or git-ignored. A tracked folder is built as is (EAS semantics); a present folder that is untracked and not ignored (`NATIVE_DIR_UNTRACKED`) or sits in a project without git (`NATIVE_DIR_NOT_IN_GIT`) is refused instead of deleted. For a tracked `android/` the `versionCode` is read from `build.gradle` / `build.gradle.kts` (Groovy and Kotlin literals), never patched; an unreadable value fails the Android build.
- `build` stops the `expo prebuild` / `fastlane` process group on SIGINT, SIGTERM and SIGHUP (terminal close) before restoring `package.json` and lockfiles (exit 130/143/129); the notice goes to stderr and, with `--json`, an `INTERRUPTED` envelope goes to stdout. A dead stdout/stderr (`EPIPE`, `EIO`) can no longer abort the restore, and an `exit` hook plus uncaught-exception handler restore synchronously as a last resort.
- Children get no stdin and `CI=1`, `FASTLANE_IS_INTERACTIVE=false`, `SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA=true` whenever `--non-interactive`, `--json` or a non-TTY applies, so prompting tools fail fast. Interactive `init` closes its prompt before `fastlane match` so the child receives keystrokes. Prompts without a trailing newline (2FA) are streamed immediately. Because fastlane's output is piped for redaction, use an App Store Connect API key or `FASTLANE_USER` + `FASTLANE_PASSWORD` for iOS; 2FA codes are still prompted.
- `init --json` includes logger warnings in `warnings`.
- `build --json` reports `prebuild` and `warnings`; `build --submit` passes `--profile` through and prints one combined JSON document.
- The iOS workspace and scheme are detected from `ios/*.xcworkspace` after prebuild. Generated Fastfile and Appfile escape values as Ruby strings; the Fastfile no longer contains an absolute or `~/` service-account path.
- Redaction covers `MATCH_KEYCHAIN_PASSWORD`, `MATCH_GIT_BEARER_AUTHORIZATION`, credentials in the Match git URL, URL-encoded, Ruby-inspected and Unicode-normalised forms, and overlapping secrets no longer leave a fragment.
- Android build and `doctor` verify that `/bin/sh` keeps dotted environment variable names (`SHELL_DROPS_DOTTED_ENV`).

---
title: Troubleshooting
description: Fixes for the most common rn-shipyard problems.
---

First, run `rn-shipyard doctor`. Most problems show up there with a fix command.

## Setup

**`doctor` fails on Ruby.** Install Fastlane with `brew install fastlane`. It brings its own Ruby, and the system Ruby is ignored.

**`Project not initialized` (exit 2).** Run `rn-shipyard init` in the project root.

**Match setup skipped.** Set `MATCH_PASSWORD` and re-run `init --platform ios`, or run `fastlane match appstore` yourself.

**`INVALID_MATCH_GIT_URL`.** The URL has a token in it. Use an SSH URL, or a plain `https://` URL with `MATCH_GIT_BASIC_AUTHORIZATION`.

**`MATCH_REPO_AUTH_FAILED`.** rn-shipyard clones the Match repo before the iOS build and the clone failed. In a terminal git and ssh may prompt you, so check the credentials you typed. With `--non-interactive`, `--json` or `CI` set, nothing can prompt: load your key into an ssh-agent (`ssh-add --apple-use-keychain ~/.ssh/id_ed25519`) or set up a credential helper. The clone is skipped when `MATCH_GIT_BASIC_AUTHORIZATION`, `MATCH_GIT_BEARER_AUTHORIZATION` or `MATCH_GIT_PRIVATE_KEY` is set.

## Build

**`NATIVE_DIR_UNTRACKED` or `NATIVE_DIR_NOT_IN_GIT`.** rn-shipyard refuses to run `prebuild --clean` over `ios/` or `android/` it cannot restore. Commit the folder, git-ignore it, or delete it.

**`SHELL_DROPS_DOTTED_ENV`.** `/bin/sh` must be the system default. Check `ls -l /bin/sh`.

**`VERSION_CODE_REUSED`.** Pass a `--version-code` greater than the reported last-used value, or omit the flag.

**`XCWORKSPACE_NOT_FOUND`.** Prebuild did not produce a workspace. Check that CocoaPods installed.

**`KEYSTORE_NOT_FOUND` or `CREDENTIALS_NOT_READABLE`.** Check `keystorePath` and `credentialsPath` in `.shipyard/config.json`.

**`REQUIREMENTS_NOT_MET` or `MISSING_CONFIG_PROJECT`.** `build`, `submit` and `init` run the `doctor` checks first. Run `rn-shipyard doctor` and follow the fix lines. If a check is wrong for your setup, `build` and `submit` accept `--skip-checks`.

**A prompt never appears.** rn-shipyard only prompts when stdin and stdout are a terminal and neither `--json`, `--non-interactive` nor `CI` is set. Unset `CI` to get prompts.

**The build hangs on a prompt.** Piped children get no stdin and `CI=1`, so a tool that wants to ask fails instead of waiting. With `--non-interactive`, make sure credentials are in the environment.

**`version not set in app.config.js; Expo uses 1.0.0`.** Your config has no `version`. Add one, or ignore the warning.

## Dynamic config

**`APP_CONFIG_EVAL_FAILED`.** Run `npx expo config --json` in the project root, with the same environment variables as the build profile, and fix what it prints.

## Submit

**Android submit skipped.** No service account configured. Set `SUPPLY_JSON_KEY` or `submit.<profile>.android.serviceAccountKeyPath` in `eas.json`.

**`MISSING_CONFIG_IOS_CREDENTIALS` (exit 2).** Set the App Store Connect API key variables, or Apple ID plus password. See [Submitting to App Store Connect](/guides/submit-app-store/).

**`APPLE_LOGIN_FAILED`.** The Apple ID login that `submit` runs on your terminal failed. Check the Apple ID and password and run `submit` again, or use an App Store Connect API key. If the message says the Fastfile has no login lane, run `rn-shipyard init` again to regenerate it.

**Ctrl-C at `Log in to your Apple account now?`.** This aborts the run with exit `130`. Nothing is built or uploaded.

**Not sure what a submit will do.** Use `rn-shipyard submit --dry-run`.

## Reporting a bug

Open an issue at [github.com/lamazzing/rn-shipyard/issues](https://github.com/lamazzing/rn-shipyard/issues) and include `rn-shipyard doctor --json` output with secrets and personal paths removed. Security problems go through [Security](/security/) instead.

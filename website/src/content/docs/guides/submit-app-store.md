---
title: Submitting to App Store Connect
description: Upload an .ipa to App Store Connect with an API key (recommended) or an Apple ID.
---

`rn-shipyard submit --platform ios` uploads the latest successful `.ipa` with Fastlane `pilot`. It does not wait for Apple's processing to finish.

rn-shipyard checks credentials before it uploads. A missing credential fails at once with `MISSING_CONFIG_IOS_CREDENTIALS` and exit code `2`. `submit` also runs the requirements pre-flight first; `--skip-checks` bypasses it.

## Option 1: App Store Connect API key (recommended)

No password, no 2FA, works unattended.

1. In App Store Connect, go to Users and Access, then Integrations, then App Store Connect API, and create a key. The role needs permission to upload builds (App Manager is enough).
2. Download the `.p8` file. Apple lets you download it once. Keep it outside the repo.
3. Note the Key ID and the Issuer ID.

```bash
export APP_STORE_CONNECT_API_KEY_KEY_ID=ABC123DEFG
export APP_STORE_CONNECT_API_KEY_ISSUER_ID=69a6de70-0000-0000-0000-000000000000
export APP_STORE_CONNECT_API_KEY_KEY_FILEPATH=~/secrets/AuthKey_ABC123DEFG.p8
rn-shipyard submit --platform ios
```

Already set up for `eas submit`? Nothing to do: rn-shipyard reads `submit.<profile>.ios.ascApiKeyPath`, `ascApiKeyId` and `ascApiKeyIssuerId` from `eas.json` (and `appleTeamId`, `ascAppId`). Environment variables, when set, win over `eas.json`.

You can pass the key contents instead of a path with `APP_STORE_CONNECT_API_KEY_KEY`. The EAS names `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID` and `EXPO_ASC_API_KEY_PATH` are accepted as aliases. If both a Fastlane name and an EAS name are set, the Fastlane name wins.

The API key is checked first.

## Option 2: Apple ID

Use this if you do not have an API key.

- The Apple ID comes from `submit.<profile>.ios.appleId` in `eas.json`, or `FASTLANE_USER` (alias `EXPO_APPLE_ID`).
- The password is an app-specific password (create one at appleid.apple.com) in `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` (alias `EXPO_APPLE_APP_SPECIFIC_PASSWORD`), or your account password in `FASTLANE_PASSWORD` (alias `EXPO_APPLE_PASSWORD`).

```bash
export FASTLANE_USER=you@example.com
export FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD=abcd-efgh-ijkl-mnop
rn-shipyard submit --platform ios
```

In an interactive terminal (and without an API key), rn-shipyard asks `Log in to your Apple account now? (Y/n)` before the upload. If you say yes, it runs the login on your terminal: Fastlane asks for the password and the 2FA code, stores the password in the keychain and caches the session, and the upload then runs non-interactive and reuses both. Ctrl-C at the question aborts the run with exit `130` and uploads nothing; closing input (Ctrl-D) counts as no. A failed login is `APPLE_LOGIN_FAILED`. With `rn-shipyard build --submit` the question is asked before the build starts. 2FA codes need a person at the terminal, so use the API key in CI, where `CI` or `--non-interactive` skips the question.

### Keychain instead of a password variable

Store the password once with Fastlane:

```bash
fastlane fastlane-credentials add --username you@example.com
```

rn-shipyard finds it by running `security find-internet-password -s deliver.<apple id>`, which only reports whether the entry exists and never prints the password. Fastlane then reads it without prompting.

## Check before you upload

```bash
rn-shipyard submit --platform ios --dry-run
```

It checks the `.ipa` exists and that credentials are available, then prints the Fastlane command.

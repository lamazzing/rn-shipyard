---
title: Your first build
description: Build an Android app bundle first, then an iOS app, from an existing Expo project.
---

Do Android first. It needs no Apple account, no certificates repo and no 2FA, so you find out fast whether your toolchain works.

All commands run from the root of your Expo project, where `eas.json` and `app.json` live.

## 1. Check the Mac

```bash
npx rn-shipyard doctor --platform android
```

Fix anything marked `✗`. See [Requirements](/getting-started/requirements/). `build` runs these checks again before it starts and stops with `REQUIREMENTS_NOT_MET` if something blocks it. `--skip-checks` bypasses that.

## 2. Android

### Set up

```bash
rn-shipyard init --platform android
```

`init` generates a release keystore at `.shipyard/android/release.keystore` with `keytool` and asks for a password (at least 6 characters). It then writes `.shipyard/config.json` and generates `fastlane/Fastfile`. The password is never written to disk.

Already shipped with EAS and want to keep the same upload key? Use [the migration flags](/guides/migrating-from-eas/#keep-your-android-upload-key) instead.

Back up the keystore and its password somewhere safe. Losing the upload key means a support request to Google.

### Build

```bash
export ANDROID_KEYSTORE_PASSWORD='the-password-you-chose'
rn-shipyard build --platform android
```

What happens, in order:

1. rn-shipyard decides whether `android/` may be regenerated, see [What prebuild does to your native folders](/faq/#what-is-prebuild-doing-to-my-native-folders).
2. `npx expo prebuild --clean` generates `android/` if needed.
3. Fastlane runs Gradle and signs the app bundle with your keystore.
4. The `.aab` lands in `output/` and the run is added to `.shipyard/history.json`.

When it finishes you have `output/<name>-<version>-<versionCode>.aab`. The versionCode comes from a counter that never reuses a number, see [Version numbers](/guides/version-numbers/).

## 3. iOS

iOS needs an Apple Developer account and a private Git repo for [Fastlane Match](/guides/ios-signing/), which stores your certificates and profiles encrypted.

### Set up

```bash
export MATCH_GIT_URL=git@github.com:you/certs.git
export MATCH_PASSWORD='an-encryption-password'
export APPLE_TEAM_ID=ABCDE12345
rn-shipyard init --platform ios
```

`init` asks for the bundle identifier, team ID and Match repo URL (the environment variables and your config fill in the defaults). With `MATCH_PASSWORD` set it runs `fastlane match appstore`. Without it, `init` skips that step and tells you to run it later.

When `init` runs `fastlane match`, it runs on your own terminal, so Git or SSH credentials, your Apple ID password and the 2FA code can be typed there. Its output is not redacted. In CI, or with `--non-interactive`, nothing prompts and a missing credential fails fast. See [CI and scripting](/guides/ci-scripting/).

### Build

```bash
rn-shipyard build --platform ios
```

Before the build lane starts, rn-shipyard clones your Match repo itself. In a terminal, Git and SSH can ask for a passphrase or credentials right then, on your terminal, so a wrong credential fails in seconds instead of after prebuild. After that the build runs unattended with redacted output.

You get `output/<name>-<version>-<buildNumber>.ipa`.

## 4. Both

```bash
rn-shipyard build --platform all
```

Platforms build one after the other. If iOS fails, Android still runs, and the exit code is `1`.

## Pick a profile

The default profile is `production`. Use any profile from your `eas.json`:

```bash
rn-shipyard build --platform android --profile preview
```

Next: [Your first submission](/getting-started/first-submission/).

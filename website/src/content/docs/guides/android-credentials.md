---
title: Android keystore and credentials
description: How rn-shipyard creates or adopts an Android keystore, where passwords come from, and how the versionCode counter works.
---

Android signing needs a keystore and its passwords. rn-shipyard never writes the passwords to disk or onto a command line.

## The keystore

Two ways to get one:

- **Generate.** `rn-shipyard init --platform android` runs `keytool` and creates `.shipyard/android/release.keystore`. The password comes from `ANDROID_KEYSTORE_PASSWORD` or a prompt (asked twice, at least 6 characters).
- **Adopt.** `rn-shipyard init --platform android --android-keystore <path>` uses a keystore you already have, for example the upload key downloaded from EAS.

The keystore file is git-ignored by `.shipyard/.gitignore` (`*.keystore`, `*.jks`). Back it up somewhere safe. If you lose the upload key, you have to ask Google to reset it.

Do not put the keystore inside `ios/` or `android/`. `expo prebuild --clean` deletes those folders, so `init` and `build` refuse with `SECRET_IN_NATIVE_DIR`.

## Where passwords come from

In this order:

1. Environment variables `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD`. The key password defaults to the keystore password.
2. A credentials JSON file, referenced by `credentialsPath` in `.shipyard/config.json` or passed to `init --android-credentials`.

## Credentials file

```json
{
  "keystorePassword": "example-store-password",
  "keyAlias": "upload",
  "keyPassword": "example-key-password",
  "keystorePath": "./upload.jks"
}
```

- `keystorePassword` and `keyAlias` are required. The password may come from `ANDROID_KEYSTORE_PASSWORD` instead.
- `keyPassword` is optional and defaults to the keystore password.
- `keystorePath` is optional. `init` uses it when `--android-keystore` is not given. A relative path resolves against the credentials file's directory.

Keep this file outside the repo. If it is inside the project and not git-ignored, `init` warns (in a `warnings` array with `--json`).

## How the passwords reach Gradle

As environment variables of the child process (`ORG_GRADLE_PROJECT_android.injected.signing.*`), and to `keytool` as `-storepass:env`. They never appear in a process list.

Gradle starts through `/bin/sh -c`. Some shells drop variables whose names contain dots. Before an Android build rn-shipyard checks, with a dummy variable and no secret, that your `/bin/sh` keeps them. If not you get `SHELL_DROPS_DOTTED_ENV`. On macOS `/bin/sh` should be the system default, not a link to zsh or dash.

## versionCode

On every Android build the versionCode is the larger of `expo.android.versionCode` (1 if unset) and `lastUsed + 1`. `lastUsed` is the larger of the counter in `.shipyard/version-code.json` and the highest versionCode of any successful Android build in history. The counter advances only after a successful build. See [Version numbers](/guides/version-numbers/).

## Moving to a new machine

Copy the keystore and the credentials file by hand, or restore them from your backup. Commit `.shipyard/config.json` and `.shipyard/version-code.json`. Paths in the config are stored project-relative or as `~/...`, so the config works on another machine.

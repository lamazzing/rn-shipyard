---
title: Security
description: How rn-shipyard handles signing secrets - environment only, redacted output, nothing sensitive written to disk - and how to report a vulnerability.
---

rn-shipyard handles signing credentials on your machine, so it is built to leak as little as possible.

## Where secrets live

Passwords come from environment variables or, for Android, from a credentials JSON file outside your repo. rn-shipyard does not write them to `.shipyard/config.json`, `history.json` or the generated Fastlane files.

## Environment, not argv

Signing passwords reach Fastlane, Gradle (`ORG_GRADLE_PROJECT_android.injected.signing.*`) and `keytool` (`-storepass:env`) through environment variables of the child process. They never appear on a command line, so they never show up in a process list.

## Prompts

Prompts for passwords do not echo, and never show a value taken from the environment (they show `[from env]`). Anything that may prompt (the Match repo clone, the Apple login) runs first on the real terminal, and only when the run is interactive: stdin and stdout are a terminal and none of `--json`, `--non-interactive` or `CI` is set. The build then runs with piped, redacted output.

## Redaction

Everything rn-shipyard pipes (the build and submit lanes, `expo prebuild`, `doctor`'s probes, the non-interactive Match clone) has secrets replaced with `***` in streamed terminal output, in output captured for `--json`, and in error messages that end up in history. This also covers the shell-quoted, escaped, URL-encoded and Unicode-normalised forms, and a secret printed with a pause in the middle.

Foreground steps are the exception: the interactive Match repo clone, the Apple login and `init`'s `fastlane match` run on your own terminal. Their output goes straight to it, is not redacted, and is never captured or logged by rn-shipyard. What you type there is handled only by git, ssh and Fastlane.

Redacted:

- `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION` (and the decoded `user:token`), `MATCH_GIT_BEARER_AUTHORIZATION`, `MATCH_KEYCHAIN_PASSWORD`, `MATCH_GIT_PRIVATE_KEY`
- the password or token embedded in `MATCH_GIT_URL`
- `FASTLANE_PASSWORD`, `FASTLANE_SESSION`, `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`, and the EAS aliases `EXPO_APPLE_PASSWORD` and `EXPO_APPLE_APP_SPECIFIC_PASSWORD`
- `APP_STORE_CONNECT_API_KEY_KEY`
- `SUPPLY_JSON_KEY_DATA`
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, and the passwords in the Android credentials file

Limit: secrets inside files that Fastlane or Match read themselves (a `.p8` file, the contents of a service-account JSON file) are not scanned for. Review logs before pasting them into public issues.

## What is written to disk

- `.shipyard/config.json`: paths and identifiers, no passwords. A Match URL with embedded credentials is rejected (`INVALID_MATCH_GIT_URL`).
- Generated Fastlane files: no absolute machine paths and no passwords. Values from your config are written as escaped Ruby strings.
- `.shipyard/history.json`: build records, git-ignored.
- The Android keystore, git-ignored. Keystores or credential files inside `ios/` or `android/` are refused, since prebuild would delete them.

See [Files rn-shipyard creates](/reference/files/).

## Native folders

rn-shipyard never runs `expo prebuild --clean` over a folder git cannot restore. See the [FAQ](/faq/#what-is-prebuild-doing-to-my-native-folders).

## Reporting a vulnerability

Report privately through [GitHub Security Advisories](https://github.com/lamazzing/rn-shipyard/security/advisories/new). Do not open a public issue and do not include real credentials. Acknowledgement is aimed at within a week. Only the latest release gets security fixes. The full policy is in [SECURITY.md](https://github.com/lamazzing/rn-shipyard/blob/main/SECURITY.md).

Out of scope: bugs in Fastlane, Expo, Xcode or Gradle (report upstream), and attackers who already control your machine or shell.

---
title: Requirements
description: What you need on your Mac to build Expo apps locally, and how to check it in one command.
---

Start with the check. It tells you exactly what is missing and prints a command to fix each problem.

```bash
npx rn-shipyard doctor
```

Run it from your Expo project root. It needs no install and changes nothing.

## Sample output

All-pass groups collapse to one line. Only groups with something to say are expanded. This run has one warning:

```text
  rn-shipyard doctor

  ✓ System (6 checks passed)

  ✓ iOS (4 checks passed)

  Android
    ✓ JDK 17+  25.0.1
    ! JAVA_HOME  not set; Gradle will use `java` from PATH
        Fix:  export JAVA_HOME="/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"   (add the line to ~/.zshrc)
        Docs: https://github.com/lamazzing/rn-shipyard#prerequisites
    ✓ Android SDK found  ~/Library/Android/sdk (ANDROID_HOME)
    ✓ SDK build-tools and platform-tools  build-tools 37.0.0
    ✓ keytool  available
    ✓ /bin/sh keeps env vars with dots  needed to pass signing passwords to Gradle

  ✓ Project (5 checks passed)

  ✓ Signing & submit (4 checks passed)

  Ready:      iOS build, iOS submit, Android build, Android submit

  Next step: Nothing blocks you (1 warning above). Run `rn-shipyard build`.
```

And a project that is not ready yet:

```text
  Project
    ✗ eas.json  not found
        Fix:  npx eas-cli build:configure   (creates eas.json; rn-shipyard only reads it)
        Docs: https://github.com/lamazzing/rn-shipyard#migrating-from-eas
    ✗ rn-shipyard set up (.shipyard/config.json)  not found: signing is not set up yet
        Fix:  rn-shipyard init
        Docs: https://github.com/lamazzing/rn-shipyard#init

  Not ready:  iOS build (2 problems), iOS submit (2 problems), Android build (2 problems), Android submit (2 problems)

  Next step: Fix the 2 items marked ✗ above, then run `rn-shipyard doctor` again.
```

How to read it:

- `✓` is fine, `!` is a warning that does not block, `✗` blocks that action.
- Each problem has a copy-paste `Fix:` line underneath, and usually a `Docs:` link.
- The summary lists which of the four actions are ready (iOS build, Android build, iOS submit, Android submit) and which are not, with a problem count.
- The last line is the one thing to do next.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No problems. Warnings alone do not fail the check |
| `1` | At least one `✗` |
| `2` | The only thing missing is project config (for example `.shipyard/config.json`) |

### The pre-flight in `build`, `submit` and `init`

`rn-shipyard build`, `rn-shipyard submit` and `rn-shipyard init` run the relevant checks first, before any prompt or long step. They stop with `REQUIREMENTS_NOT_MET` (exit `1`) if something blocks them, or `MISSING_CONFIG_PROJECT` (exit `2`) when only project config is missing, so you do not find out ten minutes into a build. Warnings are printed and never block. With `--json` the output is the same document as `doctor --json`, with `success: false` and an `error`.

- The pre-flight makes no network calls. It leaves out the Match repo reachability check (`doctor` does it) and the App Store Connect credentials check (`submit` checks credentials itself).
- `init` leaves out the checks for what it creates: `.shipyard/config.json`, `eas.json` and the whole Signing & submit group.
- `build` and `submit` accept `--skip-checks` to bypass it. `submit --dry-run` does not run it.
- Without `MATCH_PASSWORD` and without a Match passphrase in the macOS keychain (`match_<git url>`), an interactive iOS build gets a warning; with `--non-interactive`, `--json` or `CI` set it is a blocking problem.
- Android builds need a keystore password in `ANDROID_KEYSTORE_PASSWORD` or the credentials file.

Check one platform only, or get JSON:

```bash
rn-shipyard doctor --platform android
rn-shipyard doctor --json
```

## What is checked

| Area | Tool | Needed for |
|---|---|---|
| System | macOS (a warning below macOS 13) | everything. The package declares `os: darwin` |
| System | Node.js 22.12 or newer | running rn-shipyard |
| System | git | iOS builds (Match stores certificates in a git repo) |
| System | Ruby 2.7 or newer | Fastlane. Not needed if Fastlane comes from Homebrew, which bundles its own Ruby |
| System | Fastlane | iOS and Android builds, submits |
| System | Xcode command line tools | everything |
| iOS | Xcode 15 or newer, selected with `xcode-select`, license accepted | iOS builds |
| iOS | CocoaPods | iOS builds |
| Android | JDK 17 or newer, and `JAVA_HOME` (a warning if unset) | Android builds |
| Android | Android SDK (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, `android/local.properties` or `~/Library/Android/sdk`) with build-tools and platform-tools | Android builds |
| Android | `keytool` | Android builds, keystore generation |
| Android | `/bin/sh` keeps variables with dots in their name | Gradle signing passwords |
| Project | `package.json` depends on `expo`, dependencies installed, `app.json` or `app.config.*`, `eas.json`, `.shipyard/config.json` | all commands |
| Signing & submit | Match password and certificates repo, App Store Connect login, Android keystore, credentials file and password, Play service-account key | signing and submit, for the platforms you configured |

## Install the pieces

If `doctor` shows gaps, these are the usual fixes.

```bash
xcode-select --install          # command line tools. Install Xcode itself from the App Store
brew install fastlane           # brings its own Ruby
brew install cocoapods
brew install openjdk            # JDK and keytool
```

For the Android SDK, install Android Studio or the command line tools, then set `ANDROID_HOME` (usually `~/Library/Android/sdk`) in your shell profile.

Next: [Install rn-shipyard](/getting-started/install/).

---
title: Version numbers
description: rn-shipyard never bumps your marketing version. It numbers iOS builds from a counter and the latest TestFlight build, and keeps an Android versionCode counter.
---

rn-shipyard does not bump versions and never edits `app.json`. You decide the marketing version. What it maintains are the iOS build number and the Android `versionCode`, because App Store Connect and Google Play reject reused numbers.

## iOS: the build number counter

The marketing version (`expo.version`) is yours: rn-shipyard never bumps it. The build number (`CFBundleVersion`) is numbered by rn-shipyard, because App Store Connect rejects a reused one:

```text
lastUsed = max(.shipyard/version-code.json ios.lastUsed, highest numeric build number of a successful iOS build in history)
local    = max(expo.ios.buildNumber ?? 1, lastUsed + 1)       # integers only, anything else is ignored with a warning
number   = max(local, latest TestFlight build + 1)            # only when an App Store Connect API key is available
```

- With `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID` and `EXPO_ASC_API_KEY_PATH` (or `submit.<profile>.ios.ascApiKeyId`, `ascApiKeyIssuerId`, `ascApiKeyPath` in `eas.json`), the build lane asks App Store Connect for the latest build number of the app, the way EAS remote versioning does. If the call fails, it warns and uses the local counter.
- Without a key, the local counter is used and one hint line says so.
- The number is written to the generated app's `Info.plist`. It is never written to `app.json`. When `ios/` is tracked in git, the file is restored after the build.
- The counter advances only after a successful build, and the number is recorded in `.shipyard/history.json`. Commit `.shipyard/version-code.json` (it holds the Android and iOS counters).
- The `.ipa` is named with the number actually used.

### Override

```bash
rn-shipyard build --platform ios --build-number 12
```

The value must be greater than `lastUsed` (`BUILD_NUMBER_REUSED`) and, when TestFlight can be read, greater than its latest build (the lane stops). A non-positive-integer gives `INVALID_BUILD_NUMBER`.

App extensions keep the build number their project gives them; rn-shipyard only sets the app target's.

## Marketing version warning

Before building, `build` compares the current `expo.version` and `expo.ios.buildNumber` with the last successful iOS build in `.shipyard/history.json`. If both are the same you get a warning. It is a warning only; silence it with `--skip-version-check`. Bump the version yourself in `app.json` (or your dynamic config).

## Android: the versionCode counter

On every Android build:

```text
lastUsed = max(.shipyard/version-code.json counter, highest versionCode of a successful Android build in history)
next     = max(expo.android.versionCode ?? 1, lastUsed + 1)
```

- The code is applied to the generated Gradle project and the artifact name. It is never written to `app.json`.
- The counter advances only after a successful build.
- Commit `.shipyard/version-code.json`. It holds one number and keeps the counter consistent across machines.

### Override

```bash
rn-shipyard build --platform android --version-code 57
```

The value must be greater than `lastUsed`, otherwise `VERSION_CODE_REUSED`. A non-positive-integer gives `INVALID_VERSION_CODE`.

### Seed the counter when migrating

```bash
rn-shipyard init --platform android --android-last-version-code 42
```

### A committed android/ folder

If `android/` is tracked in git, rn-shipyard never edits `android/app/build.gradle`. It reads the `versionCode` from it (an integer literal in Groovy or Kotlin DSL), requires it to be greater than the last used one, and warns if it differs from the computed value. If the value is a property or an expression it cannot read, the Android build fails rather than guess, and `--version-code` is rejected. Bump it in `build.gradle` yourself.

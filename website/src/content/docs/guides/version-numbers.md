---
title: Version numbers
description: rn-shipyard never bumps your version. It warns when the iOS version looks unchanged and keeps an Android versionCode counter.
---

rn-shipyard does not bump versions and never edits `app.json`. You decide the marketing version and the iOS build number. The one thing it maintains is the Android `versionCode`, because Google Play rejects a reused code.

## iOS: a warning

Before building, `build` compares the current `expo.version` and `expo.ios.buildNumber` with the last successful iOS build in `.shipyard/history.json`. If both are the same you get a warning:

```text
iOS version 1.2.0 (build 12) was already built successfully on 2026-02-23T14:30:00Z.
Did you forget to bump the version or build number?
```

It is a warning only. Silence it with `--skip-version-check`.

Bump the version yourself in `app.json` (or your dynamic config) before building.

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

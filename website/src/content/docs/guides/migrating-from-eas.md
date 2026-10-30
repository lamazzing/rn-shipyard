---
title: Migrating from EAS
description: Which eas.json and app.json fields rn-shipyard reads, what replaces managed credentials, and how to keep your Android upload key and versionCode.
---

rn-shipyard reads the config you already have. Your `eas.json` and `app.json` (or `app.config.*`) are never modified, so you can keep using EAS next to it.

## Command mapping

| EAS | rn-shipyard |
|---|---|
| `eas build` | `rn-shipyard build` (local: `expo prebuild` + Fastlane/Gradle) |
| `eas submit` | `rn-shipyard submit` (Fastlane `pilot` and `supply`) |
| `eas credentials` | You own them: Fastlane Match for iOS, a keystore you keep for Android |
| `eas build --profile x` | `rn-shipyard build --profile x` |
| `eas build --local` | The whole tool is a local build |
| `eas update` | Not supported |

## Field mapping

### eas.json

| Field | Used for |
|---|---|
| `build.<profile>` | Selected with `--profile` (default `production`) |
| `build.<profile>.env` (including `extends`) | Applied to config evaluation, prebuild and Fastlane, see [Dynamic config](/guides/dynamic-config/) |
| `submit.<profile>.ios.appleId` | Apple ID for the Apple ID submit flow |
| `submit.<profile>.ios.appleTeamId` | Default for the Apple Team ID |
| `submit.<profile>.ios.ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId` | App Store Connect API key for `submit` |
| `submit.<profile>.ios.ascAppId` | App Store Connect app ID passed to the upload |
| `submit.<profile>.android.serviceAccountKeyPath` | Google Play service account key |
| `submit.<profile>.android.track` | Play track, default `internal` |
| `submit.<profile>.android.releaseStatus` | Release status, default `draft` |

Anything else in `eas.json` is ignored. In particular `autoIncrement`, `distribution`, `channel` and `resourceClass` do nothing.

### app.json

| Field | Used for |
|---|---|
| `expo.name`, `expo.slug` | Required. App name, artifact names |
| `expo.version` | Artifact names and version check. If it is missing, rn-shipyard warns and uses `1.0.0`, as Expo does |
| `expo.ios.bundleIdentifier` | Default for the bundle ID in `init` |
| `expo.ios.buildNumber` | Version check warning |
| `expo.android.package` | Android application ID |
| `expo.android.versionCode` | Lower bound for the versionCode counter |

If you use `app.config.ts`, `.js`, `.mjs` or `.cjs`, rn-shipyard evaluates it with `npx expo config --json`, like EAS does, with the `env` of your build profile applied and your `.env` loaded. A dynamic config takes precedence over `app.json`. See [Dynamic config](/guides/dynamic-config/).

### Environment variable names

The EAS names for Apple and App Store Connect credentials (`EXPO_APPLE_ID`, `EXPO_APPLE_PASSWORD`, `EXPO_APPLE_APP_SPECIFIC_PASSWORD`, `EXPO_APPLE_TEAM_ID`, `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`) work as aliases for the Fastlane names. If both are set, the Fastlane name wins. See [Environment variables](/reference/environment-variables/#eas-aliases).

## Keep your Android upload key

EAS holds the upload keystore for you. To keep shipping updates to the same Play listing, download it and hand it to `init`:

```bash
eas credentials                      # download the keystore for the Android app
rn-shipyard init --platform android \
  --android-keystore ~/secrets/myapp-upload.jks \
  --android-credentials ~/secrets/myapp-credentials.json \
  --android-last-version-code 42
```

The credentials file is JSON, kept outside the repo:

```json
{
  "keystorePassword": "example-store-password",
  "keyAlias": "upload",
  "keyPassword": "example-key-password"
}
```

`--android-last-version-code` is the highest versionCode you already shipped. rn-shipyard seeds its counter with it and never reuses a code. To see the number EAS holds:

```bash
npx eas-cli build:version:get -p android -e production
```

More in [Android keystore and credentials](/guides/android-credentials/).

## iOS certificates

EAS manages your distribution certificate and provisioning profile. With rn-shipyard they live in a private Git repo, encrypted by Fastlane Match. You can create new ones or let Match generate them on first run. See [iOS signing with Fastlane Match](/guides/ios-signing/).

Apple limits the number of distribution certificates per team. If you hit the limit during `match`, revoke an unused one in the Apple Developer portal first. Do not revoke the one EAS still uses if you keep building there.

## What does not carry over

OTA updates, remote builds, Windows and Linux, monorepos, custom Fastlane lanes, build caching, parallel builds and automatic version bumping are not supported. See the [roadmap](/roadmap/) and the [FAQ](/faq/).

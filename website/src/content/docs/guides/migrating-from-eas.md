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

## Import your EAS credentials (one command)

`init --from-eas` imports the signing credentials EAS holds, so you switch without a new iOS certificate and without a new Android upload key.

### 1. Download them from EAS

```bash
npx eas-cli credentials
```

Run it in the project folder, once per platform (`npx eas-cli credentials -p ios`). eas-cli has no non-interactive download, so it is a menu. These are all its questions, in order:

1. Expo login, if you are not signed in (`npx eas-cli login`).
2. "Which build profile do you want to configure?" (only if `eas.json` has several): **production**.
3. iOS only: "Do you want to log in to your Apple account?": answer **n**. The download only reads Expo's servers, so no Apple login is needed (eas-cli skips the question when `EXPO_ASC_API_KEY_PATH` or `EXPO_ASC_KEY_ID` is set, and then signs in with that key instead).
4. "What do you want to do?": **credentials.json: Upload/Download credentials between EAS servers and your local json**.
5. **Download credentials from EAS to credentials.json**.
6. "Press any key to continue", then **Go back** and **Exit**. Do not press Ctrl-C.

In a terminal you can skip all of this: if `credentials.json` is missing, `rn-shipyard init --from-eas` prints these answers and offers to run `npx eas-cli credentials -p <platform>` for you, then imports. (`npx` may ask once to install `eas-cli`.)

 It writes `credentials.json` plus a `credentials/` folder (`credentials/android/keystore.jks`, `credentials/ios/dist-cert.p12`, `credentials/ios/profile.mobileprovision`). `credentials.json` holds the passwords in plain text. An app with extensions (several iOS targets) gets one entry per target.

### 2. Import

```bash
rn-shipyard init --from-eas                              # ./credentials.json, both platforms in the file
rn-shipyard init --platform android --from-eas           # one platform
rn-shipyard init --from-eas path/to/credentials.json     # another location
```

If the file is missing and there is no terminal (`--non-interactive`, `--json`, CI), `init` stops with `EAS_CREDENTIALS_NOT_FOUND` (exit `2`) and repeats the menu path in `fix`. A platform that is not in the file is skipped with a warning; `init` never generates a new key in its place.

**Android.** `init` opens the keystore with `keytool` (passwords through the environment, never argv), checks the key alias and the key password, and prints the SHA-256 certificate fingerprint. It copies the keystore to `~/.config/rn-shipyard/<slug>/release.keystore` and writes `android-credentials.json` next to it (folder mode `700`, files `600`), then configures `.shipyard/config.json` with `~/` paths, exactly like `--android-keystore` and `--android-credentials`. Compare the fingerprint with Google Play Console > your app > Test and release > App integrity > App signing > Upload key certificate: they must be identical. A different keystore already in that folder is never overwritten silently: in a terminal you are asked (the old file is kept as `.bak-<time>`), with `--non-interactive` the command stops with `EAS_KEYSTORE_EXISTS`. If EAS managed your versionCode, add `--android-last-version-code <n>`.

**iOS.** `init` converts the EAS distribution certificate in a private temporary folder (mode `700`, removed on success, failure and Ctrl-C): EAS's `.p12` has a password, while Match stores the certificate as a `.cer` plus the private key as an unencrypted RSA PEM (named `.p12`). So it extracts those two with `openssl` (the password goes through the environment, never argv; macOS's LibreSSL and Homebrew's OpenSSL 3+ both work; a non-RSA key is refused). The plaintext key exists only in the temp folder. Then it runs `fastlane match import` through an internal lane (`shipyard_match_import`). That command matches the certificate with your Apple developer account, encrypts the files with `MATCH_PASSWORD`, and commits and **pushes** them to your Match repo. Every target's provisioning profile is imported. You need:

- `MATCH_GIT_URL`, `APPLE_TEAM_ID` and the Match password: `MATCH_PASSWORD`, or the macOS keychain item match reads (in a terminal `init` asks for what is missing and offers to save the password in the keychain; for a new repo choose the password now and keep it).
- Git access to the repo and an Apple login. In a terminal both prompt normally on your own terminal (Apple ID, 2FA). With `--non-interactive` there is no prompt: use an App Store Connect API key (`APP_STORE_CONNECT_API_KEY_KEY_ID`, `_ISSUER_ID`, `_KEY_FILEPATH`) and ssh-agent or `MATCH_GIT_BASIC_AUTHORIZATION`.

**Known limitation:** profiles of app extensions are imported into the repo, but `build` only fetches the profile of the main bundle ID (`ios.bundleIdentifier`).

### 3. Check, build, then delete the plaintext files

`init` prints (and with `--json` returns in `nextSteps`) what to do next:

1. Compare the Android fingerprint with Play Console (above).
2. Build once: `rn-shipyard build --platform all`.
3. When that works, delete the plaintext EAS files. They contain your signing passwords, so do not leave them around or commit them:

```bash
rm -r -- credentials.json credentials/      # eas-cli's default layout
rm -- credentials.json android/keystores/release.keystore    # a layout with files elsewhere
```

`init` prints the exact command for your files. It lists individual files, and collapses to the `credentials/` folder only when that is eas-cli's default folder and holds nothing but your credentials. It never lists `android/` or `ios/`. rn-shipyard never deletes your files. `init` adds those paths to your `.gitignore` and warns if they are not ignored or are already tracked by git (`git rm --cached -- <file>` untracks one).

If the keystore or the `.p12` was ever pushed or shared, changing the passwords does not help, because the key file itself is exposed. Request an upload-key reset in Play Console, revoke the distribution certificate in the Apple Developer portal, and purge the files from your git history.

During the import the plaintext private key exists only in a private temporary folder (mode `700`), as in fastlane's own flow. It is removed on success, failure and Ctrl-C; a hard kill (SIGKILL) can leave it in your `$TMPDIR`, so delete `shipyard-eas-ios-*` folders there if that happens.

## Keep your Android upload key

If you prefer to place the files yourself:

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

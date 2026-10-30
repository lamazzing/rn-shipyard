---
title: Your first submission
description: Upload the .ipa to App Store Connect and the .aab to Google Play, and check it first with a dry run.
---

`submit` uploads the latest successful build of each platform from `.shipyard/history.json`. Build first, then submit.

## Dry run first

```bash
rn-shipyard submit --dry-run
```

This checks the artifact, the credentials and the service account, prints the Fastlane command it would run, and uploads nothing. It writes no history either, and it does not run the requirements pre-flight.

## Android: Google Play

You need a service account JSON key with access to your app in Play Console. See [Submitting to Google Play](/guides/submit-google-play/).

```bash
export SUPPLY_JSON_KEY=~/secrets/play-service-account.json
rn-shipyard submit --platform android
```

The track and release status come from `eas.json` (`submit.<profile>.android.track` and `releaseStatus`) and default to `internal` and `draft`. If no service account is configured, Android is skipped with a message.

The first upload of a new app has to be done by hand in Play Console. The API can only add releases to an app that already exists.

## iOS: App Store Connect

An App Store Connect API key is the recommended credential. See [Submitting to App Store Connect](/guides/submit-app-store/).

```bash
export APP_STORE_CONNECT_API_KEY_KEY_ID=ABC123DEFG
export APP_STORE_CONNECT_API_KEY_ISSUER_ID=69a6de70-0000-0000-0000-000000000000
export APP_STORE_CONNECT_API_KEY_KEY_FILEPATH=~/secrets/AuthKey_ABC123DEFG.p8
rn-shipyard submit --platform ios
```

The build goes to App Store Connect (TestFlight processing happens on Apple's side). rn-shipyard does not wait for processing to finish.

Before uploading, `submit` runs the requirements pre-flight for the platforms it submits. `--skip-checks` bypasses it.

With an Apple ID instead of an API key, in a terminal, `submit` first asks `Log in to your Apple account now? (Y/n)` and runs the login on your terminal, where Fastlane asks for the password and the 2FA code. Ctrl-C at the question aborts with exit `130` and uploads nothing. The upload itself then runs unattended.

## Build and submit in one go

```bash
rn-shipyard build --platform all --submit
```

It submits only if no platform failed, using the same `--profile`. With an Apple ID (no API key), the Apple login question is asked before the build starts, not after a long build. Ctrl-C there aborts with exit `130`; nothing is built or uploaded.

## See what happened

```bash
rn-shipyard history
```

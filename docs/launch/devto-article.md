> **DRAFT. Not published. Owner reviews, adds the demo GIF, and publishes by hand.**

---
title: How I build and submit Expo apps on my Mac without the EAS queue
published: false
tags: expo, reactnative, ios, android
cover_image: https://lamazzing.github.io/rn-shipyard/og.png
---

I ship Expo apps on my own. For a while every release started the same way: run `eas build`, then wait. On EAS's free plan, cloud builds can wait in a shared queue, and priority comes with a paid plan (current details are on [Expo's pricing page](https://expo.dev/pricing)). Meanwhile my Mac, which can build both apps, was idle.

So I wrote [rn-shipyard](https://github.com/lamazzing/rn-shipyard), a small MIT-licensed CLI that builds and submits Expo apps from your own Mac using [fastlane](https://fastlane.tools). This post walks through the workflow I use, what it does not do, and how it compares to the alternatives. It is independent of Expo and not affiliated with or endorsed by Expo.

## What you need

macOS 13 or newer, Node.js 20 or newer, an Expo project with dependencies installed (and an `eas.json`), and the usual native tooling: Xcode and CocoaPods for iOS, a JDK 17 and the Android SDK for Android, plus fastlane. You also need an Apple Developer account for iOS and a Google Play developer account for uploads.

You do not have to remember that list. Run this from your project root:

```bash
npx rn-shipyard doctor
```

`doctor` checks the tools above, your project files and your signing setup. For each problem it prints the command that fixes it, for example `sudo xcodebuild -license accept` when the Xcode license is not accepted. It ends with a per-action summary: which of iOS build, iOS submit, Android build and Android submit are ready. Run it again after each fix.

## Step 1: one-time setup

```bash
rn-shipyard init --platform all
```

`init` reads your `eas.json` and Expo config (`app.json`, or `app.config.ts`/`.js`, evaluated with `npx expo config --json`, the way EAS CLI does). It never writes to those files. It then:

- for iOS, asks for the bundle identifier, Apple team ID and the git URL of a private repo for [fastlane match](https://docs.fastlane.tools/actions/match/), and runs `match appstore` if `MATCH_PASSWORD` is set;
- for Android, generates a release keystore with `keytool`, or adopts one you pass in;
- writes `.shipyard/config.json` and a readable `fastlane/Fastfile`, `Appfile` and `Matchfile`.

If you are coming from EAS and want to keep the upload key Expo holds, download it with `eas credentials` and hand it over:

```bash
rn-shipyard init --platform android \
  --android-keystore ~/secrets/myapp-upload.jks \
  --android-credentials ~/secrets/myapp-credentials.json \
  --android-last-version-code 42
```

The last flag seeds the versionCode counter, so a code you already shipped is never reused.

## Step 2: build

```bash
rn-shipyard build --platform all --profile production
```

For each platform, `build` runs `expo prebuild` and then fastlane (gym for iOS, Gradle for Android). The output streams to your terminal as it happens, with secrets masked. Artifacts land in `output/`, and each run is recorded in `.shipyard/history.json`.

Two details worth knowing. First, prebuild only runs for native folders that are missing or git-ignored. If you committed `ios/` or `android/`, they are built as they are, and a folder that is neither committed nor ignored is refused, because `expo prebuild --clean` would delete work git cannot restore. Second, the platforms build one after the other, and if iOS fails, Android still runs.

## Step 3: submit

```bash
rn-shipyard submit --platform all --dry-run
rn-shipyard submit --platform all
```

`submit` uploads the latest successful build of each platform: the `.ipa` to App Store Connect and the `.aab` to Google Play. Track and release status come from `eas.json`. The upload happens on your machine, with an App Store Connect API key (or Apple ID) and a Google Play service account that you provide. `--dry-run` checks the artifact and credentials and prints the fastlane command without uploading anything, which is a good habit on the first run. `rn-shipyard build --submit` combines both steps.

## Scripting it

Every command takes `--json` and `--non-interactive`. With `--json` you get one document with a top-level `success` boolean, and errors look like `{ "success": false, "error": { "code", "message", "fix" } }`. Exit codes are 0 for success, 1 for an error and 2 for missing configuration. That makes it easy to wrap in your own scripts.

## How it compares

**EAS cloud builds** are the mature product. No Mac needed, managed credentials, EAS Update for OTA, and a team behind it. If you have no Mac or want builds off your machine, that is the better fit today.

**`eas build --local`** builds on your machine. As of eas-cli 18.1.0, it requires you to be logged in to an Expo account with the project linked to EAS, and its help text marks `--local` as experimental. `eas submit` runs the upload on Expo's servers, and credentials stay in Expo's store.

**rn-shipyard** needs no Expo account and no EAS project, submits directly from your Mac, and keeps credentials in standard fastlane match and your own keystore. Because it generates a plain Fastfile, you can read it, or run fastlane yourself if you ever stop using the CLI.

You can also use both: nothing in your EAS configuration is changed.

## Limits

This is a version 0.1.0 project, and the limits are real:

- macOS only. No Windows or Linux.
- No OTA updates (EAS Update).
- No monorepos, no custom fastlane lanes, no build caching.
- iOS and Android build sequentially, not in parallel.
- It does not bump your version for you. It warns when the iOS version looks unchanged and keeps an Android versionCode counter.

Hosted builds without the queue, for people with no Mac, are on the roadmap. Nothing hosted exists today.

## Try it

```bash
npx rn-shipyard doctor
```

Docs are at [lamazzing.github.io/rn-shipyard](https://lamazzing.github.io/rn-shipyard/) and the code is on [GitHub](https://github.com/lamazzing/rn-shipyard). If something breaks on your project, open an issue with the output of `rn-shipyard doctor --json` (remove secrets and personal paths first). That is the feedback I need most.

*Expo and EAS are trademarks of 650 Industries, Inc., mentioned only to describe compatibility and comparison. rn-shipyard is not affiliated with or endorsed by Expo.*

---
title: FAQ
description: Answers to common questions about rn-shipyard - EAS local builds, Macs, Apple accounts, and what prebuild does.
---

## Why not just `eas build --local`?

EAS can build on your machine, but it is still tied to Expo. As of eas-cli 18.1.0:

- `eas build --local` requires you to be logged in to an Expo account and the project to be linked to EAS. Its help text marks `--local` as experimental.
- `eas submit` always runs the upload on Expo's servers.
- Credentials stay in Expo's credential store.

rn-shipyard needs no Expo account and no EAS project, works offline until the upload, submits straight from your Mac to App Store Connect and Google Play, and keeps credentials in standard Fastlane Match and your own keystore. It also generates a readable Fastfile you can run yourself. EAS is the mature product with a large team; rn-shipyard is new.

## Do I need a Mac?

Yes, for iOS. Xcode only runs on macOS. For Android a Mac works too, and that is what rn-shipyard supports. Windows and Linux are not supported. If you have no Mac, EAS cloud builds are the better fit today, and hosted builds are on the [roadmap](/roadmap/).

## Do I need an Apple Developer account?

For iOS builds and submits, yes. Apple requires it for signing and for App Store Connect. Android needs only a Google Play developer account when you submit. You can build an Android app bundle without either.

## Does it modify my project?

It never modifies `eas.json`, `app.json` or `app.config.*`. A dynamic `app.config.*` is evaluated with `npx expo config --json` (with your build profile's `env` and your `.env`), never edited. It writes `.shipyard/`, `fastlane/` and `output/`, appends patterns to your `.gitignore`, and runs `expo prebuild`, which can generate `ios/` and `android/`. After prebuild it restores `package.json` and lockfiles if prebuild changed them.

## What is prebuild doing to my native folders?

`expo prebuild --clean` deletes and regenerates `ios/` and `android/`. rn-shipyard only allows that where git can bring the folder back or where the folder is disposable:

- Committed folder: prebuild is skipped, your project is built as is.
- Missing folder: generated.
- Folder that is git-ignored: regenerated with `--clean`.
- Folder that is neither committed nor ignored, or a project not under git: refused. Commit it, ignore it, or delete it yourself.

If you maintain native code by hand, commit `ios/` and `android/`.

## Does it bump my version?

No. It warns when the iOS version looks unchanged, and keeps an Android versionCode counter. See [Version numbers](/guides/version-numbers/).

## Can I use it next to EAS?

Yes. Nothing in your EAS configuration is changed.

## Can I run iOS and Android at the same time?

No. Platforms build one after the other. One failing does not stop the other.

## Does it send any data anywhere?

rn-shipyard has no server and no telemetry. It runs Expo, Fastlane and your build tools, which talk to Apple, Google and your Git host as they normally do. This documentation site has no tracking scripts.

## Is there a hosted version?

Not yet. See the [roadmap](/roadmap/).

## About this project

rn-shipyard is an independent open-source project, not affiliated with or endorsed by Expo. Expo and EAS are trademarks of 650 Industries, Inc. They are mentioned here only to describe compatibility, migration and comparison.

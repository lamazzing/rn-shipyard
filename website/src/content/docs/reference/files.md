---
title: Files rn-shipyard creates
description: What lives in .shipyard/, fastlane/ and output/, and which of it to commit.
---

```text
your Expo project
├── eas.json / app.json    read only, never modified
├── .shipyard/
│   ├── config.json        written by init (merged per platform, never reset)
│   ├── history.json       build and submit log
│   ├── version-code.json  Android versionCode counter
│   ├── .gitignore         written by init
│   └── android/           generated release keystore
├── fastlane/              generated Fastfile, Appfile, Matchfile
└── output/                built .ipa and .aab
```

## What to commit

| Path | Commit? |
|---|---|
| `.shipyard/config.json` | Yes |
| `.shipyard/version-code.json` | Yes. A number only, keeps the counter consistent across machines |
| `.shipyard/.gitignore` | Yes |
| `.shipyard/history.json` | No. Ignored by `.shipyard/.gitignore` |
| `.shipyard/android/*.keystore`, `*.jks` | Never. Ignored |
| `credentials.json` and `credentials/` from `eas credentials` | Never. `init --from-eas` adds them to `.gitignore`; delete them once the import works |
| `~/.config/rn-shipyard/<slug>/` (written by `init --from-eas`) | Not in the repo. Folder `700`, files `600` |
| Credentials JSON, service-account JSON, `.p8`, `.p12`, provisioning profiles, `.env` | Never. Keep them outside the repo |
| `fastlane/Fastfile`, `Appfile`, `Matchfile` | Yes |
| `fastlane/report.xml`, `fastlane/README.md` | No |
| `output/` | No |

`.shipyard/version-code.json` is not in the ignore list, so a plain `git add .shipyard` includes it, which is what you want.

## .shipyard/config.json

Written by `init`. Holds platforms, bundle ID, team ID, Match URL, keystore path, credentials path and the output directory. It holds no passwords. Paths are stored project-relative, or as `~/...` under your home directory, so the file works on another machine.

## .shipyard/history.json

An entry per build and submit: id, timestamp, command, profile, and per platform the status, version, build number or versionCode, artifact path, duration and error. Local to your machine.

## fastlane/

`Fastfile`, `Appfile` and (for iOS) `Matchfile`. Generated from templates with your values escaped as Ruby strings. No absolute machine paths and no passwords. `Appfile` has your bundle ID, team ID and Apple ID; `Matchfile` has your Match repo URL. You can read and run the Fastfile yourself.

## .gitignore changes

`init` appends keystore and artifact patterns to your project `.gitignore`.

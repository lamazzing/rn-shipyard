---
title: Submitting to Google Play
description: Create a Google Play service account, point rn-shipyard at it, and choose track and release status.
---

`rn-shipyard submit --platform android` uploads the latest successful `.aab` with Fastlane `supply`.

## Create the service account

1. In Google Cloud, create a service account in a project and create a JSON key for it.
2. In Play Console, open Users and permissions, invite the service account's email and give it access to your app, with permission to manage releases.
3. Save the JSON key outside your repo.

Google's setup screens change. If a step does not match, follow Google's current "set up API access" guide.

Create the app and upload the first release by hand in Play Console. The API only works on an app that already exists.

## Point rn-shipyard at the key

In order of precedence:

1. `SUPPLY_JSON_KEY`, the path to the JSON file.
2. `submit.<profile>.android.serviceAccountKeyPath` in `eas.json`.
3. `serviceAccountKeyPath` in `.shipyard/config.json`.

```bash
export SUPPLY_JSON_KEY=~/secrets/play-service-account.json
rn-shipyard submit --platform android
```

If none is set, Android is skipped with a message and the other platform still submits.

Never commit the key. Keep the file outside the repo.

## Track and release status

Set them in `eas.json`:

```json
{
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "../secrets/play-service-account.json",
        "track": "internal",
        "releaseStatus": "draft"
      }
    }
  }
}
```

Defaults are `internal` and `draft`. A draft release needs you to roll it out in Play Console.

## Dry run

```bash
rn-shipyard submit --platform android --dry-run
```

It checks the artifact and the service account, prints the Fastlane command and uploads nothing.

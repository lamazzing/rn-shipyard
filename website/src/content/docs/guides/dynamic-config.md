---
title: Dynamic config and build-profile env
description: How rn-shipyard evaluates app.config.js or app.config.ts, applies the env of your eas.json profile, and loads .env.
---

Many Expo apps compute their config in `app.config.js` and switch values by environment. rn-shipyard handles that the way EAS does.

## What gets evaluated

If your project has `app.config.ts`, `app.config.js`, `app.config.mjs` or `app.config.cjs` (looked up in that order, the first one found is used), rn-shipyard runs

```bash
npx expo config --json
```

in the project root and reads the result. A dynamic config takes precedence over `app.json`. Without one it reads `app.json`. The `expo` package must be installed in the project (`node_modules/expo`), and the command has 60 seconds to finish.

`build` evaluates the config with the env of the profile you selected. `init` evaluates it with the env of the `production` profile. If `version` is not set, rn-shipyard warns (`version not set in app.config.js; Expo uses 1.0.0`) and uses `1.0.0`, as Expo does.

## Build-profile env

The `env` of the selected `eas.json` build profile is applied to everything that runs for that build:

- config evaluation (`npx expo config --json`)
- `expo prebuild`
- Fastlane and the native build

`extends` is followed, so a profile that extends another one gets the parent's `env` with its own on top. Values may be strings, numbers or booleans (converted to strings); anything else is dropped with a warning.

rn-shipyard owns some names and never takes them from a profile: its secret variables (`MATCH_PASSWORD`, `FASTLANE_PASSWORD`, `ANDROID_KEYSTORE_PASSWORD` and the rest of the redacted ones), `MATCH_GIT_URL`, anything starting with `SHIPYARD_`, the git configuration variables (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`, `GIT_CONFIG_PARAMETERS`), and the variables that keep child processes from prompting (`CI`, `FASTLANE_IS_INTERACTIVE`, ...). These are ignored with a warning. `PATH`, `NODE_OPTIONS`, `RUBYOPT`, `GIT_SSH_COMMAND`, `BUNDLE_GEMFILE` and `DYLD_*` are applied, with a warning, because they change how tools run. The full lists are in [Environment variables](/reference/environment-variables/#build-profile-env-and-env).

```json
{
  "build": {
    "base": { "env": { "APP_ENV": "production" } },
    "production": { "extends": "base", "env": { "API_URL": "https://api.example.com" } }
  }
}
```

```bash
rn-shipyard build --platform ios --profile production
```

In `app.config.js`, `process.env.APP_ENV` and `process.env.API_URL` are set while the config is evaluated.

## .env files

`.env` is loaded the same way `expo prebuild` loads it. Unlike EAS cloud builds, which do not have your `.env`, rn-shipyard does not set `EXPO_NO_DOTENV`, because it builds locally where `expo prebuild` and Metro read `.env`. The config rn-shipyard reads is therefore the one your build sees.

## rn-shipyard never edits your config

It does not write to `app.json` or `app.config.*`. For dynamic configs, when something has to be added to your config, rn-shipyard prints the snippet and you add it yourself.

## Errors

| Code | Meaning |
|---|---|
| `APP_CONFIG_EVAL_FAILED` | `npx expo config --json` failed, did not print JSON, or the `expo` package is not installed. Run it yourself in the project root to see the error, and run `npm install` |
| `INVALID_APP_CONFIG` | The config is missing `name` or `slug`, or `app.json` is not valid JSON. A missing `version` is not an error: it defaults to `1.0.0` with a warning |

Run `npx expo config --json` with the same environment variables to reproduce:

```bash
APP_ENV=production npx expo config --json
```

See [Error codes](/reference/error-codes/).

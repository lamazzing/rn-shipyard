---
title: CI and scripting
description: Use --json and --non-interactive, exit codes and environment variables to run rn-shipyard from scripts and unattended jobs.
---

Every command supports two global flags, and the exit codes are stable. That is the whole scripting interface.

| Flag | Effect |
|---|---|
| `--json` | One JSON document on stdout, always with a top-level `success` |
| `--non-interactive` | Never prompt. Fail with a clear error instead |

A command also behaves non-interactively when stdin or stdout is not a terminal, when `--json` is set, or when the `CI` environment variable is set to anything except `0` or `false`. That last rule means a CI runner that gives you a pseudo-terminal still never waits on a prompt.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error. At least one platform or check failed (including `REQUIREMENTS_NOT_MET`) |
| `2` | Missing configuration: not initialized, project config missing (`MISSING_CONFIG_PROJECT`), or a required value is missing in `--non-interactive` mode |
| `130`, `143`, `129` | Interrupted by SIGINT, SIGTERM, SIGHUP |

## A minimal script

```bash
#!/usr/bin/env bash
set -euo pipefail

rn-shipyard doctor --json --non-interactive > doctor.json
rn-shipyard build --platform all --json --non-interactive > build.json
rn-shipyard submit --platform all --json --non-interactive > submit.json
```

Read results with `jq`:

```bash
jq -r '.platforms.ios.artifactPath' build.json
jq -r '.error.code // empty' build.json
```

`build --submit --json` returns one document with the submit result under the `submit` key.

## Requirements pre-flight

`build`, `submit` and `init` run the `doctor` checks first and stop with `REQUIREMENTS_NOT_MET` (exit `1`) or `MISSING_CONFIG_PROJECT` (exit `2`) before doing anything slow. With `--json` the document has the shape of `doctor --json` with `success: false`. In a non-interactive run a missing `MATCH_PASSWORD` is a blocking problem; interactively it is a warning. The pre-flight makes no network calls. Pass `--skip-checks` to `build` or `submit` to bypass it (`submit --dry-run` does not run it). `init` runs it without the checks for what it creates: `.shipyard/config.json`, `eas.json` and the Signing & submit group.

## Credentials in unattended runs

Nothing can prompt, so everything comes from the environment. You can use the EAS variable names as aliases: `EXPO_APPLE_ID`, `EXPO_APPLE_PASSWORD`, `EXPO_APPLE_APP_SPECIFIC_PASSWORD`, `EXPO_APPLE_TEAM_ID`, `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID` and `EXPO_ASC_ISSUER_ID`. If the matching Fastlane name is also set, the Fastlane name wins. See [Environment variables](/reference/environment-variables/#eas-aliases).

| For | Variables |
|---|---|
| Match repo | `MATCH_GIT_URL`, `MATCH_PASSWORD`, `APPLE_TEAM_ID`, and `MATCH_GIT_BASIC_AUTHORIZATION` or an ssh-agent |
| Android signing | `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` |
| App Store Connect | `APP_STORE_CONNECT_API_KEY_KEY_ID`, `_ISSUER_ID`, `_KEY` or `_KEY_FILEPATH` |
| Google Play | `SUPPLY_JSON_KEY` |

Before an iOS build, rn-shipyard clones the Match repo itself. Non-interactively that clone runs in batch mode (no terminal prompt, no askpass or credential-manager dialog, `ssh -o BatchMode=yes`, 15 s connect timeout), so a Match repo that needs a password or an unknown host fails fast with `MATCH_REPO_AUTH_FAILED`. Load your key into an ssh-agent or configure a credential helper. The clone is skipped when `MATCH_GIT_BASIC_AUTHORIZATION`, `MATCH_GIT_BEARER_AUTHORIZATION` or `MATCH_GIT_PRIVATE_KEY` is set.

Prefer the App Store Connect API key over an Apple ID: 2FA needs a person. The `Log in to your Apple account now?` question and the Apple login only happen in a terminal, and only without an API key.

## Two phases

Like EAS CLI, rn-shipyard splits a run in two. Phase 1 is everything that may prompt, and it runs on your real terminal: the Apple login question and login, the Match repo clone, and `init`'s `fastlane match`. These foreground steps are not redacted and not logged by rn-shipyard. Phase 2 is the build or upload, and it is always piped and redacted. Phase 1 only happens when the run is interactive; in CI, with `--json` or with `--non-interactive` there is only phase 2.

## What rn-shipyard sets for child processes

Every piped child (`expo prebuild`, `npx expo config`, `fastlane`, `fastlane match`, `git`) gets no stdin and the environment `CI=1`, `FASTLANE_IS_INTERACTIVE=false`, `SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA=true`, `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS` and `SSH_ASKPASS` set to `true`, `SSH_ASKPASS_REQUIRE=never` and `GCM_INTERACTIVE=never`, so a tool that wants to ask a question fails immediately instead of hanging. This holds in interactive runs too.

## Interruption

On SIGINT, SIGTERM or SIGHUP rn-shipyard stops the running `expo prebuild` or `fastlane` process group (or the foreground step), waits for it to exit, removes the temporary Match clone, restores `package.json` and the lockfiles, and exits `130`, `143` or `129`. Ctrl-C at the Apple login question aborts the whole run with `130`: nothing is built or uploaded. With `--json` an `INTERRUPTED` error document is written to stdout if it is still open.

## Scope

rn-shipyard builds on a Mac. It has no hosted-runner integration and no CI/CD features of its own. These are scripting hooks for your own Mac, for a self-hosted macOS runner or a build box you control.

See also [JSON output and exit codes](/reference/json-and-exit-codes/) and [Environment variables](/reference/environment-variables/).

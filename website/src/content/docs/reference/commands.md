---
title: Commands
description: Every rn-shipyard command and flag - doctor, init, build, submit, history.
---

```text
rn-shipyard [--json] [--non-interactive] [-V, --version] [-h, --help] <command>
```

## Global flags

| Flag | Description |
|---|---|
| `--json` | Machine-readable output, see [JSON output and exit codes](/reference/json-and-exit-codes/) |
| `--non-interactive` | Never prompt. Fail with a clear error instead |
| `-V, --version` | Print the version |
| `-h, --help` | Help for the program or a command |

Global flags work before or after the command name.

## doctor

```bash
rn-shipyard doctor [-p, --platform <ios|android|all>]
```

Checks that this Mac can build and submit, and prints a fix for each problem.

| Flag | Default | Description |
|---|---|---|
| `-p, --platform <platform>` | `all` | `ios`, `android` or `all` |

The output is grouped: System, iOS, Android, Project, Signing & submit. Groups where everything passes collapse to one line. Each check is `✓`, `!` or `✗`, with a copy-paste `Fix:` line under every problem. A readiness summary says which of iOS build, Android build, iOS submit and Android submit are ready, and a "Next step" line names what to do first. A platform that is not in `.shipyard/config.json` is "not set up" (next step: `rn-shipyard init --platform <p>`), and a submit is ready only when a successful build in history still has its `.ipa`/`.aab` on disk (otherwise: `no .ipa yet: run rn-shipyard build --platform ios`). In `--json`, `readiness.<action>` then carries `state` (`not-set-up` or `no-artifact`) and `note`. A warning (never a failure, nothing is deleted) appears when EAS's plaintext `credentials.json` / `credentials/` are still on disk after a successful build, with the exact `rm` command and whether they are git-ignored or tracked. For Android it also checks that `/bin/sh` keeps environment variables with dots in their name. Unlike the pre-flight that `build`, `submit` and `init` run, `doctor` also checks that the Match certificates repo is reachable (a `git ls-remote`, which needs the network) and that App Store Connect credentials are present. The EAS names (`EXPO_APPLE_ID` and the others) count like their Fastlane equivalents. See [Requirements](/getting-started/requirements/).

With `--json` it prints `success`, `checks`, `readiness`, `summary` and `nextStep`, plus `error` when something failed.

Exit `0` if nothing fails (warnings alone are fine), `1` on any `✗`, `2` when only project config is missing.

## init

```bash
rn-shipyard init [-p, --platform <ios|android|all>]
                 [--android-keystore <path>]
                 [--android-credentials <path>]
                 [--android-last-version-code <n>]
                 [--from-eas [path]]
```

One-time setup for the project.

| Flag | Default | Description |
|---|---|---|
| `-p, --platform <platform>` | `all` | `ios`, `android` or `all` |
| `--android-keystore <path>` | | Use an existing keystore instead of generating one |
| `--android-credentials <path>` | | JSON file with `keystorePassword`, `keyAlias`, `keyPassword`. Keep it outside the repo |
| `--android-last-version-code <n>` | | Seed the versionCode counter, for example with EAS's remote counter |
| `--from-eas [path]` | | Import the signing credentials `eas credentials` downloaded (`credentials.json`, default `./credentials.json`; a folder with one also works). Cannot be combined with `--android-keystore` or `--android-credentials` |

Interactive by default when stdin and stdout are a terminal. With `--non-interactive`, with `--json`, when `CI` is set (and not `0` or `false`), or when stdin or stdout is not a TTY, `init` never prompts: values come from environment variables and your Expo config, and a missing value exits `2`. Piped answers are not supported. Password prompts do not echo and never show a value taken from the environment (they show `[from env]`; Enter accepts it).

Before anything else, `init` runs the requirements pre-flight for the selected platforms (see [build](#requirements-pre-flight)). It leaves out the checks for what `init` creates: `.shipyard/config.json`, `eas.json` and the whole Signing & submit group. A blocking problem stops `init` with `REQUIREMENTS_NOT_MET` (exit `1`) or `MISSING_CONFIG_PROJECT` (exit `2`).

What it does:

- iOS: asks for bundle identifier, Apple Team ID and the Match Git URL, with defaults from `app.json`, `eas.json`, `APPLE_TEAM_ID` and `MATCH_GIT_URL`. If `MATCH_PASSWORD` is set it runs `fastlane match appstore`: in a terminal on your own terminal (so Git, SSH, Apple ID and 2FA prompts work, and its output is not redacted), otherwise piped, detached from the terminal and redacted. Without `MATCH_PASSWORD` it skips and says so. The `EXPO_*` credential names are accepted, see [Environment variables](/reference/environment-variables/#eas-aliases).
- Android: generates `.shipyard/android/release.keystore` with `keytool`, or adopts the keystore you pass.
- Writes `.shipyard/config.json`, `.shipyard/.gitignore`, `fastlane/Fastfile`, `Appfile` (and `Matchfile` for iOS), and appends keystore and artifact patterns to your project `.gitignore`.

`--from-eas`: reads the EAS `credentials.json` and imports it. Android: the keystore is verified with `keytool` (alias and key password too), copied to `~/.config/rn-shipyard/<slug>/` (folder `700`, files `600`), its SHA-256 fingerprint is printed, and `.shipyard/config.json` is configured like `--android-keystore` plus `--android-credentials`. iOS: the distribution certificate is converted with `openssl` in a private temp folder, then `fastlane match import` (internal lane `shipyard_match_import`) encrypts it with `MATCH_PASSWORD` and pushes it with every target's provisioning profile to the Match repo; it needs `MATCH_GIT_URL`, `APPLE_TEAM_ID`, `MATCH_PASSWORD` and an Apple login (a terminal, or an App Store Connect API key with `--non-interactive`). A platform missing from the file is skipped with a warning. `--json` adds `imported` (paths as `~/...`, fingerprints, never a password), `plaintextFiles` and `nextSteps`. The EAS files are never deleted: the delete command is printed once a build works. See [Migrating from EAS](/guides/migrating-from-eas/).

Flag errors: an Android flag with `--platform ios`, `--android-credentials` without a keystore, or a bad `--android-last-version-code` give `INVALID_FLAGS`.

## build

```bash
rn-shipyard build [-p, --platform <ios|android|all>] [--profile <name>] [--submit]
                  [--skip-version-check] [--version-code <n>] [--skip-checks]
```

| Flag | Default | Description |
|---|---|---|
| `-p, --platform <platform>` | `all` | `ios`, `android` or `all` |
| `--profile <profile>` | `production` | Build profile from `eas.json` |
| `--submit` | off | Submit after a successful build, with the same `--profile`. Only if no platform failed |
| `--skip-version-check` | off | Skip the warning about an unchanged iOS version |
| `--version-code <n>` | | Android versionCode. Must be greater than the last used one. Rejected when `android/` is tracked in git |
| `--skip-checks` | off | Skip the requirements pre-flight (the `doctor` checks that run first). It makes no network calls |

Per platform: decide whether `expo prebuild --clean` may run, run it, build with Fastlane, write the artifact to `output/`, record history. iOS and Android run one after the other, independently. The iOS workspace is the single `ios/*.xcworkspace` found after prebuild, and its name is the scheme.

| `ios/` or `android/` | What happens |
|---|---|
| tracked in git | prebuild is skipped, the committed project is built as is |
| missing | generated with `expo prebuild` |
| present and git-ignored | regenerated with `expo prebuild --clean` |
| present, untracked, not ignored | refused with `NATIVE_DIR_UNTRACKED` |
| present, project not under git | refused with `NATIVE_DIR_NOT_IN_GIT` |

After prebuild, `package.json` and the lockfiles are restored if prebuild rewrote them.

With `--json` the result is `{ success, platforms, prebuild, warnings }`. `prebuild.<platform>.action` is `generated`, `skipped_tracked` or `refused`.

Exit `0` all platforms succeeded, `1` any failed, `2` not initialized.

### Requirements pre-flight

Once `.shipyard/config.json` is found, `build` runs the `doctor` checks for the enabled platforms before any prompt or long step (with `--submit`, the submit checks too). A `✗` stops the run with `REQUIREMENTS_NOT_MET` (exit `1`), or `MISSING_CONFIG_PROJECT` (exit `2`) when only project config is missing. It prints each failed check with its fix, and with `--json` the same document as `doctor --json` with `success: false`. Warnings are printed and never block. The pre-flight makes no network calls, so it leaves out the Match repo check (the iOS build clones that repo right away and fails fast) and the App Store Connect credentials check (`submit` has its own). `--skip-checks` bypasses it. Without `MATCH_PASSWORD`, an interactive build only warns; with `--non-interactive` (or `CI`, or no TTY) it is a blocking problem.

### Config and profile env

`app.config.*` is evaluated with `npx expo config --json`, with the `env` of the selected profile applied. If `version` is not set, rn-shipyard warns and uses `1.0.0`, as Expo does. See [Dynamic config](/guides/dynamic-config/).

### Questions and prompts

Everything that may prompt runs first, on your real terminal; after that the build runs piped and redacted, see [CI and scripting](/guides/ci-scripting/).

- `build --submit` with an Apple ID (no App Store Connect API key): the question `Log in to your Apple account now? (Y/n)` is asked right after the pre-flight, before the build starts. Answer yes and Fastlane asks for the password and 2FA code. Ctrl-C at the question aborts the run with exit `130` and builds and uploads nothing. Closed input (Ctrl-D) counts as no.
- iOS: before the build lane, rn-shipyard clones the Match repo itself (a bare clone into a private temp dir, removed afterwards). In a terminal, git and ssh may prompt on your terminal (ssh passphrase, https credentials, credential helpers). With `--non-interactive` the clone cannot prompt: ssh runs in `BatchMode`, and a failure stops that platform with `MATCH_REPO_AUTH_FAILED`. The clone is skipped when `MATCH_GIT_BASIC_AUTHORIZATION`, `MATCH_GIT_BEARER_AUTHORIZATION` or `MATCH_GIT_PRIVATE_KEY` is set, since Fastlane authenticates with those without prompting.

## submit

```bash
rn-shipyard submit [-p, --platform <ios|android|all>] [--profile <name>] [--dry-run] [--skip-checks]
```

| Flag | Default | Description |
|---|---|---|
| `-p, --platform <platform>` | `all` | `ios`, `android` or `all` |
| `--profile <profile>` | `production` | Submit profile from `eas.json` |
| `--dry-run` | off | Check everything and print the Fastlane command without uploading. Writes no history |
| `--skip-checks` | off | Skip the requirements pre-flight (the `doctor` checks that run first; they do not run with `--dry-run` anyway) |

Uploads the latest successful build of each platform from history: `.ipa` to App Store Connect with `pilot`, `.aab` to Google Play with `supply`. Platforms submit independently. Before the upload, `submit` runs the requirements pre-flight for the submit actions, and a missing App Store Connect credential fails at once with `MISSING_CONFIG_IOS_CREDENTIALS`. In a terminal, with an Apple ID and no API key, it first asks `Log in to your Apple account now? (Y/n)` and logs in on your terminal (Ctrl-C aborts with exit `130` and uploads nothing); a failed login is `APPLE_LOGIN_FAILED`. The upload itself is piped and redacted. See [App Store Connect](/guides/submit-app-store/) and [Google Play](/guides/submit-google-play/).

With `--dry-run --json`, each requested platform has `status` (`ok`, `skipped` or `error`), `artifactPath`, `command` and `problems`.

Exit `0` all succeeded or skipped, `1` any failed or no artifacts, `2` not initialized or iOS credentials missing.

## history

```bash
rn-shipyard history [-p, --platform <ios|android>] [-l, --limit <n>]
```

| Flag | Default | Description |
|---|---|---|
| `-p, --platform <platform>` | all | Filter by `ios` or `android` |
| `-l, --limit <limit>` | `10` | Number of entries to show |

Shows builds and submits from `.shipyard/history.json` as a table. The table is plain text (no colour codes) when stdout is not a terminal or `NO_COLOR` is set. Exit `0`.

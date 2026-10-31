---
title: iOS signing with Fastlane Match
description: Set up certificates and provisioning profiles for iOS builds with Fastlane Match and a private Git repo.
---

rn-shipyard signs iOS builds with [Fastlane Match](https://docs.fastlane.tools/actions/match/), type `appstore`. Match keeps your distribution certificate and provisioning profile encrypted in a private Git repo. Any Mac that can read the repo and knows the encryption password can build.

## Set up

1. Create a private Git repo for the certificates, for example `git@github.com:you/certs.git`. Keep it private and keep it separate from your app repo.
2. Choose an encryption password and note your Apple Team ID.
3. Run `init`:

```bash
export MATCH_GIT_URL=git@github.com:you/certs.git
export MATCH_PASSWORD='an-encryption-password'
export APPLE_TEAM_ID=ABCDE12345
rn-shipyard init --platform ios
```

`init` writes the URL into `.shipyard/config.json` and `fastlane/Matchfile`, then runs `fastlane match appstore`. Running it for iOS never touches your Android setup. Without a Match password it skips that step, and the summary says "Match signing NOT set up" with the next step. Run it later with `rn-shipyard init --platform ios` after exporting the password.

## Where the Match password lives

- **Locally (macOS):** the keychain. fastlane match reads its passphrase from `MATCH_PASSWORD`, else from the keychain item with server `match_<git url>`. In a terminal, `init` offers to save it there: it runs `security add-internet-password -s match_<git url> -U -w`, and macOS's `security` asks for the password on your terminal (it never appears in a command line or in rn-shipyard's output). From then on you do not export `MATCH_PASSWORD` for builds, and `doctor` and the build pre-flight accept the keychain item (they only check that it exists, never read it).
- **CI and `--non-interactive`:** the environment variable `MATCH_PASSWORD` (a CI secret). A CI runner has no keychain item.
- A wrong password saved in the keychain makes match fail to decrypt; delete it with `security delete-internet-password -s "match_<git url>"` and run `init` again.

## Check the App Store Connect key

If you use an App Store Connect API key for `submit`, `init` verifies it with one read-only call (`GET /v1/apps` for your bundle ID). A key with a role that is too low (`ASC_KEY_FORBIDDEN`, needs App Manager or Admin) or a wrong key/issuer (`ASC_KEY_INVALID`) stops `init` instead of failing at your first submit. A missing app record only warns: create the app in App Store Connect first.

## Keep credentials out of the URL

The Match URL is committed, so it must not contain a token. A URL such as `https://x-access-token:TOKEN@github.com/org/certs.git` is rejected with `INVALID_MATCH_GIT_URL` and nothing is written. Use one of:

- An SSH URL, `git@github.com:org/certs.git`, with a key in your ssh-agent.
- A plain `https://github.com/org/certs.git` plus `MATCH_GIT_BASIC_AUTHORIZATION`, the base64 of `user:token`.

```bash
export MATCH_GIT_BASIC_AUTHORIZATION=$(printf 'you:ghp_yourtoken' | base64)
```

## How authentication works

Before the iOS build lane starts, rn-shipyard clones the Match repo itself (a bare clone into a private temporary folder, removed afterwards), so a bad credential fails in seconds, not after prebuild. In a terminal, that clone runs on your real terminal: git and ssh can ask for an ssh passphrase, https credentials or use a credential helper. The build lane then runs non-interactive, with git redirected to the local clone (Match keeps your real URL, so the passphrase in your keychain is still found), with its output piped and redacted.

With `--non-interactive`, `--json`, or `CI` set, nothing prompts. The clone runs in batch mode (`GIT_TERMINAL_PROMPT=0`, no askpass or credential-manager dialog, `ssh -o BatchMode=yes`) and a failed clone stops with `MATCH_REPO_AUTH_FAILED`. The fix is an ssh-agent with your key loaded, or a credential helper. The clone is skipped when `MATCH_GIT_BASIC_AUTHORIZATION`, `MATCH_GIT_BEARER_AUTHORIZATION` or `MATCH_GIT_PRIVATE_KEY` is set, because Fastlane authenticates with those without prompting.

`init` runs `fastlane match` on your own terminal when it is interactive (Apple ID, 2FA and git prompts work, output is not redacted); otherwise it is piped and detached from the terminal. See [CI and scripting](/guides/ci-scripting/).

## Environment variables

| Variable | Meaning |
|---|---|
| `MATCH_GIT_URL` | Match repo URL, no credentials in it |
| `MATCH_PASSWORD` | Encryption password for the repo contents |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID. `init` uses it as the default. `EXPO_APPLE_TEAM_ID` is accepted as an alias for `FASTLANE_TEAM_ID`, the name Fastlane reads |
| `MATCH_GIT_BASIC_AUTHORIZATION` | base64 of `user:token` for HTTPS repos |
| `MATCH_GIT_BEARER_AUTHORIZATION` | Bearer token for HTTPS repos |
| `MATCH_KEYCHAIN_PASSWORD` | Keychain password, if Match needs it |
| `MATCH_GIT_PRIVATE_KEY` | Private key for the repo |

All of the secret ones are redacted from output. See [Environment variables](/reference/environment-variables/) for the full table.

## Builds

`build` runs `match(type: "appstore", readonly: true)`, so a build never creates or revokes certificates. Only `init` does that.

## Lost the password

Match data cannot be decrypted without `MATCH_PASSWORD`. Store it in a password manager. If you lose it, you have to start over with new certificates: see Match's `nuke` action in the Fastlane documentation, which revokes certificates, so read it carefully, then run `init` again.

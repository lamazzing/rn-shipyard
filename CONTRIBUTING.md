# Contributing to rn-shipyard

Thanks for helping. rn-shipyard is intentionally small, so please read the scope rules below before starting work.

## Development setup

Requirements: macOS, Node.js >= 22.12. Fastlane and Xcode are only needed to run real builds, not the test suite.

```bash
git clone https://github.com/lamazzing/rn-shipyard.git
cd rn-shipyard
npm ci
npm run lint    # tsc --noEmit
npm test        # vitest, shell layer mocked
npm run build   # tsup -> dist/index.js
```

## Running the CLI locally against an Expo app

```bash
npm run build
cd /path/to/your-expo-app
node /path/to/rn-shipyard/dist/index.js doctor
node /path/to/rn-shipyard/dist/index.js init --platform ios
```

Or run `npm link` in this repo and use `rn-shipyard` directly. `npm run dev` rebuilds on change. Prefer `submit --dry-run` while testing so nothing is uploaded.

## QA suite

`npm test` mocks git, fastlane and the terminal, so its mocks share the code's assumptions. The QA suite (`tests/qa`) runs the **built** CLI (`dist/index.js`) as a child process, with real git, fastlane, Gradle and CocoaPods, against throwaway Expo projects. It needs no Apple account and no secrets, and it is not part of `npm test`.

```bash
npm run test:qa                 # builds, then runs tests/qa (about 10 to 25 minutes, needs the network)
npx vitest run -c vitest.qa.config.ts tests/qa/contracts.test.ts   # one file, after `npm run build`
```

What it covers:

- `scenarios.test.ts`: `init` and `doctor` over a matrix of layouts (app at the repo root, app in an `app/` subfolder of the repo, no git), modes (`--non-interactive`, `--json`) and states (fresh, re-init, outdated Fastfile, second platform added). `doctor` must report git-ignored EAS leftovers as ignored, never "no git info", when a repo exists.
- `android.test.ts`: `keytool` keystore, `init`, a real `build --platform android`, then the signed `.aab` is checked with `jarsigner` and the history file. Skipped without an Android SDK and JDK 17 or newer.
- `ios.test.ts`: `MATCH_AUTH_MISSING` without starting fastlane; real `expo prebuild` + `pod install`, then the real `shipyard_ios_resolve` lane with the arguments the CLI passes, to prove paths resolve from `fastlane/`. Skipped without Xcode, fastlane and CocoaPods.
- `contracts.test.ts`: every `--json` output is one document with `success` and, on failure, `error.code/message/fix` (or a failed platform), exit codes are only 0, 1 or 2; no ANSI escapes when piped or with `NO_COLOR`; the credential `init` validated (an App Store Connect key) is the one the Match lane receives.
- `tests/utils/questions.test.ts` (runs in `npm test`): every interactive question has a stable id in `src/utils/questions.ts` with its non-interactive equivalent (flag, env var, config or "never asked"). `Prompter.ask(id, ...)` takes the id first; a prompt without an id, an id without a table row, a stale row, or a row naming a flag or env var that does not exist fails the test. When you add a question, add its row.

Fastlane and Match are never given real credentials: a `fastlane` shim on `PATH` records the calls of the Match and build lanes and passes everything else to the real fastlane, the Match repo is an empty local bare repository, and the one App Store Connect HTTPS call `init` makes is answered by a preloaded fetch stub (`tests/qa/support/stub-fetch.cjs`). A scenario that exposes a product bug is marked `it.fails` with a `// QA-BUG:` comment.

Environment variables:

| Variable | Effect |
|---|---|
| `QA_FIXTURE_DIR` | Use this prepared Expo project (with or without `node_modules`) instead of running `npx create-expo-app@latest --template blank-typescript` |
| `QA_KEEP=1` | Keep the temp directory of the run (printed at the end) |
| `QA_RUN_DIR_BASE` | Create the run directory here instead of the OS temp dir |
| `ANDROID_HOME` | Android SDK location (also found at `~/Library/Android/sdk`) |

Everything happens in the run's temp directory; nothing outside it is touched. In CI, `.github/workflows/qa.yml` runs the suite on pull requests, pushes to `main`, nightly, on demand and via `workflow_call`; a failing nightly or `main` run opens or updates one issue labelled `qa-failure`.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for file schemas and module layout, and [PRODUCT.md](./PRODUCT.md) for what the product does. Conventions are in [CLAUDE.md](./CLAUDE.md): TypeScript strict, functional modules (no classes), async file I/O, `child_process.spawn` (never `exec`) with streamed output, Node readline for prompts (no prompt libraries), and tests with vitest against a mocked shell layer.

Every command must support `--json` and `--non-interactive`, use exit codes 0 (success), 1 (error), 2 (missing config), and return `{ success: boolean, ... }` (errors as `{ success: false, error: { code, message, fix } }`). One platform's failure must not stop the other.

## Scope and non-goals

These will not be accepted:

- EAS Update / OTA support
- Remote or cloud builds (exception: the planned GitHub Actions cloud build on the [roadmap](https://lamazzing.github.io/rn-shipyard/roadmap/); discuss before starting)
- Windows or Linux support
- Monorepo support
- Custom Fastlane lanes
- Build caching
- Parallel platform builds (builds are sequential)
- CI/CD integration features
- Automatic version bumping (rn-shipyard warns, and only maintains the Android versionCode counter)
- A GUI or TUI
- Modifying a user's `eas.json`, `app.json` or `app.config.js`
- New runtime dependencies or external prompt libraries without prior discussion

If in doubt, open an issue before writing code.

## Security

Never commit credentials: keystores, `.p8`/`.p12` files, provisioning profiles, service-account JSON, `.env` files, or real Apple IDs and team IDs in tests and fixtures. Tests must use obviously fake values. Report vulnerabilities privately, see [SECURITY.md](./SECURITY.md).

## Contributor License Agreement

Before your first pull request can be merged, you sign the [CLA](./CLA.md). You keep the copyright in your work. The agreement lets the project owner distribute contributions under other license terms in addition to MIT, which matters if a hosted offering is built on rn-shipyard later. The open-source code stays MIT.

To sign, comment on your pull request with exactly: `I have read the CLA Document and I hereby sign the CLA`. A bot records your GitHub username once and you will not be asked again.

## Releasing (maintainers)

1. Bump `version` in `package.json` and add the release to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v0.1.1 && git push origin main v0.1.1`.
3. `.github/workflows/release.yml` runs lint, tests and build, then publishes to npm with
   provenance through npm trusted publishing (no token). The tag must match the version.

## Definition of done

Every user-facing change updates, in the same PR: `README.md`, the docs site
(`website/src/content/docs/`, including the commands, error-code and environment-variable
reference pages) and `CHANGELOG.md`. Maintainers then release it to npm (see Releasing).

## Pull requests

Use conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`), keep PRs focused, add tests, and make sure lint, test and build pass.

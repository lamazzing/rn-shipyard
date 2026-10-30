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

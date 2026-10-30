---
title: Contributing
description: How to set up rn-shipyard for development, what is in scope, and how to send a pull request.
---

rn-shipyard is intentionally small. Read the scope rules before starting.

## Development setup

You need macOS and Node.js 20 or newer. Fastlane and Xcode are only needed for real builds, not for the test suite.

```bash
git clone https://github.com/lamazzing/rn-shipyard.git
cd rn-shipyard
npm ci
npm run lint    # tsc --noEmit
npm test        # vitest, shell layer mocked
npm run build   # tsup -> dist/index.js
```

Run your build against a real Expo app:

```bash
npm run build
cd /path/to/your-expo-app
node /path/to/rn-shipyard/dist/index.js doctor
```

Or `npm link` and use `rn-shipyard` directly. Use `submit --dry-run` while testing so nothing is uploaded.

## Conventions

TypeScript strict, functional modules (no classes), async file I/O, `child_process.spawn` with streamed output, Node readline for prompts, vitest with a mocked shell layer. Every command supports `--json` and `--non-interactive`, and exits 0, 1 or 2. One platform's failure must not stop the other.

## Out of scope

Pull requests for these will not be accepted: OTA updates, remote builds, Windows or Linux, monorepos, custom Fastlane lanes, build caching, parallel builds, CI/CD integration features, automatic version bumping, a GUI or TUI, modifying a user's `eas.json`, `app.json` or `app.config.*`, and new runtime dependencies without discussion. If in doubt, open an issue first.

## Security

Never commit credentials. Tests use obviously fake values. Report vulnerabilities privately, see [Security](/security/).

## Contributor License Agreement

Before your first pull request can be merged, you sign the [CLA](https://github.com/lamazzing/rn-shipyard/blob/main/CLA.md). You keep the copyright in your work. The agreement lets the project owner distribute contributions under other license terms in addition to MIT, which matters if hosted builds are built on rn-shipyard later. The open-source code stays MIT.

To sign, comment on your pull request with exactly: `I have read the CLA Document and I hereby sign the CLA`. A bot records your GitHub username once.

## Pull requests

Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`), keep them focused, add tests, and make sure lint, test and build pass.

This site lives in `website/` and every page has an edit link.

Full text: [CONTRIBUTING.md](https://github.com/lamazzing/rn-shipyard/blob/main/CONTRIBUTING.md) and [ARCHITECTURE.md](https://github.com/lamazzing/rn-shipyard/blob/main/ARCHITECTURE.md).

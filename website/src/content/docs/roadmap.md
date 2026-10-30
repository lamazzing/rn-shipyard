---
title: Roadmap
description: What might come next (cloud builds on your own GitHub Actions, hosted builds) and what rn-shipyard does not do.
---

## Planned: cloud builds with your own GitHub Actions

Build in the cloud without a Mac of your own and without an Expo account, on GitHub's macOS runners:

- `rn-shipyard cloud init` would generate a workflow in your app's repository and store the signing secrets (keystore and passwords, Match password, App Store Connect API key) as GitHub Actions secrets.
- `rn-shipyard build --cloud` would start that workflow, stream the log to your terminal and download the `.ipa` / `.aab` when it finishes.

It uses your own GitHub Actions minutes. Hosted runners are free for public repositories; private repositories use the minutes included in your GitHub plan, and macOS minutes count more than Linux ones. See [GitHub's pricing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) for the current numbers. It is not built yet and has no date. If you would use it, [say so in Discussions](https://github.com/lamazzing/rn-shipyard/discussions).

## Hosted builds: on the roadmap

Hosted builds without the queue are on the roadmap, for people who have no Mac or want builds off their machine. Nothing hosted exists today. If you want it, [tell us you're interested](https://github.com/lamazzing/rn-shipyard/discussions) in GitHub Discussions. There is no form and no tracking.

## On purpose not planned

These are out of scope for the open-source CLI:

- OTA updates (EAS Update)
- Windows and Linux
- Monorepos
- Custom Fastlane lanes
- Build caching
- Parallel platform builds
- Automatic version bumping
- A GUI or TUI

If you disagree with one of them, open a discussion before writing code. See [Contributing](/contributing/).

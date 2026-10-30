---
title: Install
description: Install rn-shipyard globally with npm, or run it with npx.
---

rn-shipyard is an npm package. It needs Node.js 20 or newer on macOS.

```bash
npm install -g rn-shipyard
rn-shipyard --version
```

Or run it without installing:

```bash
npx rn-shipyard doctor
```

Per project, you can also add it as a dev dependency and call it through `npx`:

```bash
npm install --save-dev rn-shipyard
npx rn-shipyard build --platform android
```

## What it touches

Installing adds a binary and nothing else. Running commands in a project creates `.shipyard/`, `fastlane/` and `output/` there, see [Files rn-shipyard creates](/reference/files/). It never edits `eas.json`, `app.json` or `app.config.*`.

## Update

```bash
npm install -g rn-shipyard@latest
```

Changes are listed in the [changelog](https://github.com/lamazzing/rn-shipyard/blob/main/CHANGELOG.md).

Next: [Your first build](/getting-started/first-build/).

> **DRAFT. Nothing here has been applied. The owner runs the commands below by hand.**

# GitHub repo settings and launch checklist

## Description (max 120 characters)

```text
Build and submit Expo iOS and Android apps locally with fastlane. No queue, no Expo account. macOS, MIT.
```

(104 characters)

## Website

`https://lamazzing.github.io/rn-shipyard/`

## Topics (13)

`expo`, `react-native`, `eas`, `fastlane`, `ios`, `android`, `cli`, `app-store`, `google-play`, `mobile-ci`, `local-builds`, `macos`, `app-store-connect`

## Apply with gh (do not run until the repo is public and you are ready)

```bash
gh repo edit lamazzing/rn-shipyard \
  --description "Build and submit Expo iOS and Android apps locally with fastlane. No queue, no Expo account. macOS, MIT." \
  --homepage "https://lamazzing.github.io/rn-shipyard/" \
  --add-topic expo --add-topic react-native --add-topic eas --add-topic fastlane \
  --add-topic ios --add-topic android --add-topic cli --add-topic app-store \
  --add-topic google-play --add-topic mobile-ci --add-topic local-builds \
  --add-topic macos --add-topic app-store-connect \
  --enable-discussions
```

## Social preview image

GitHub only accepts this through the web UI (no API or `gh` flag). In the repo go to Settings, General, Social preview, Edit, Upload an image, and choose `website/public/og.png` from a local checkout. GitHub recommends at least 640 x 320 px (1280 x 640 px is ideal) and a file under 1 MB; check that `og.png` meets this before uploading. Verify afterwards by pasting the repo URL into a chat or social composer.

## Discussions

Enable Discussions (the `--enable-discussions` flag above does it), then set up these categories under Discussions, Categories:

- **Announcements** (maintainers only post): releases and breaking changes.
- **Q&A** (answer format): setup and usage questions.
- **Ideas** (open format): feature suggestions. Remind people that the scope list in CONTRIBUTING.md is firm.
- **Hosted builds interest** (open format): the roadmap page points here. State in the pinned post that nothing hosted exists, and that this is only a place to say what you would need. No dates, no prices.

Category creation is a web UI step; there is no `gh` command for it.

## Good first issues (5)

All are inside the project scope. Create them with the `good first issue` label by hand or with `gh issue create`.

1. **Add troubleshooting entries for the most common `doctor` failures.** The docs page `website/src/content/docs/troubleshooting.md` is short. Add entries for Xcode license not accepted, `JAVA_HOME` unset, and a missing Android build-tools directory, each with the fix command `doctor` prints. Docs only.
2. **Write a "Google Play service account" guide.** The README gives one sentence. Add a step-by-step page under `website/src/content/docs/guides/` (create the service account, grant access in Play Console, point `SUPPLY_JSON_KEY` at the key). Docs only.
3. **More tests for Kotlin DSL versionCode parsing.** For a tracked `android/`, versionCode is read from `build.gradle` or `build.gradle.kts`. Add test cases for formatting variants (spacing, `versionCode = 5`, comments nearby) in the existing vitest suite with the shell layer mocked.
4. **Document `app.config.ts` setups with `APP_VARIANT` and `eas.json` `build.<profile>.env`.** Add a worked example to the docs of how a profile's env reaches the config evaluation and the build, using fake values.
5. **Add a "migrating from EAS" checklist page.** Collect the existing README material (what is read from `eas.json`, exporting the Android upload key with `eas credentials`, `--android-last-version-code`) into one ordered checklist on the docs site. Docs only.

## Launch-day checklist (in this order)

1. [ ] Final review of the `prep/public-release` state (see the project memory note about squash-merging to keep the private app name out of public history).
2. [ ] Merge `prep/launch` into `main`. Review the CLA workflow once more: it must not check out PR code.
3. [ ] Make the repo public.
4. [ ] Apply the settings above (description, homepage, topics, Discussions), upload the social preview, create the Discussions categories and the pinned post.
5. [ ] Create the `cla-signatures` branch if the action does not (the action creates it on the first signature, but check that branch protection on `main` does not block it). Open a test PR from a second account to confirm the bot asks for a signature.
6. [ ] Turn on GitHub Pages (Settings, Pages, Source: GitHub Actions) and run the Docs workflow. Open https://lamazzing.github.io/rn-shipyard/ and click through.
7. [ ] `npm publish` (version 0.1.0, after confirming the CHANGELOG entry is dated and the package contents with `npm pack --dry-run`).
8. [ ] From a clean machine or a fresh user account, run `npx rn-shipyard doctor` and confirm it installs and prints sensible output.
9. [ ] Create the 5 good first issues.
10. [ ] Post spaced out, not all at once: Show HN first (weekday, US morning), then the X thread a few hours later, then Reddit (only after reading rules) the next day, then the dev.to article within the week. Reply to comments on each as they come in.
11. [ ] Record the demo (`demo-script.md`) before step 10 so it can go on the X post and in the README later.

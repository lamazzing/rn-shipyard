> **DRAFT. Not posted. Owner reads each subreddit's current rules first.**

# Reddit drafts

## Before posting (required)

I could not verify the current rules of either subreddit from here. Self-promotion is restricted on many programming subreddits (often a ratio of promotion to normal participation, a required flair, a weekly showcase thread, or a ban on links to your own projects). Before posting, the owner must:

1. Read the sidebar rules and pinned posts of r/reactnative and r/expo, and check whether there is a "Showoff Saturday" or similar thread that is the only allowed place for project posts.
2. Check whether the account's history is enough (a brand-new account that only posts its own project is usually removed).
3. Use the required flair, if any.
4. Disclose that you are the author, in the first line.
5. Do not post both on the same day with identical text, and do not cross-post the same body.

If either subreddit disallows project posts, use its showcase thread or skip it. Reply to comments rather than editing the post for promotion.

## r/reactnative

**Title:** I built a CLI that builds and submits Expo apps from your own Mac with fastlane (no EAS queue, no Expo account)

**Body:**

```text
Disclosure: I'm the author. It's free and MIT licensed.

I ship Expo apps on my own and kept waiting on cloud builds. On EAS's free plan builds can wait in a shared queue, and priority comes with a paid plan (see https://expo.dev/pricing for the current details). My Mac sat idle the whole time, so I wrote rn-shipyard.

What it does:

- Reads your existing eas.json and Expo config (app.json or app.config.ts/js). It never edits them.
- `rn-shipyard init` sets up signing: fastlane match for iOS, a keystore you control for Android (you can import the one from `eas credentials`).
- `rn-shipyard build` runs expo prebuild and then fastlane/Gradle on your machine. Output streams live.
- `rn-shipyard submit` uploads the .ipa to App Store Connect and the .aab to Google Play directly from your Mac.
- `rn-shipyard doctor` checks Xcode, JDK, Android SDK, Fastlane and so on, and prints the command that fixes each problem.

    npx rn-shipyard doctor

About `eas build --local`: it exists, but as of eas-cli 18.1.0 it needs an Expo login and a linked EAS project, and its help marks it experimental. `eas submit` runs on Expo's servers. rn-shipyard needs neither.

Limits: macOS only, no OTA updates (EAS Update), no Windows/Linux, no monorepos, iOS and Android build one after the other. It's version 0.1.0, so expect rough edges. EAS is the mature product and the right choice if you want cloud builds or have no Mac.

Repo: https://github.com/lamazzing/rn-shipyard
Docs: https://lamazzing.github.io/rn-shipyard/

I'd like to hear which setups break it, especially dynamic app.config.ts projects and unusual native folders. Not affiliated with or endorsed by Expo.
```

## r/expo (shorter)

**Title:** rn-shipyard: build and submit Expo apps locally with fastlane, reading your eas.json (open source, MIT)

**Body:**

```text
Disclosure: I'm the author.

rn-shipyard is a CLI for people who already have an Expo project and a Mac. It reads eas.json and your Expo config (never edits them), runs expo prebuild and fastlane locally, and submits to App Store Connect and Google Play from your machine. No Expo account or EAS project needed. Start with `npx rn-shipyard doctor`.

Differences from `eas build --local`, as of eas-cli 18.1.0: that command needs an Expo login and a linked project and is marked experimental, and `eas submit` runs on Expo's servers.

Limits: macOS only, no OTA, no monorepos, new project (0.1.0).

Repo: https://github.com/lamazzing/rn-shipyard
Docs: https://lamazzing.github.io/rn-shipyard/

Feedback on what fails on your project is the most useful thing. Not affiliated with or endorsed by Expo.
```

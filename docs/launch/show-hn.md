> **DRAFT. Not posted. Owner reviews and posts by hand.**

# Show HN

Post the repo link as the URL: https://github.com/lamazzing/rn-shipyard. Post the comment below immediately after submitting, as the first comment. Do not ask for upvotes anywhere.

## Title options (max 80 characters)

1. `Show HN: rn-shipyard – Build and submit Expo apps from your Mac, no queue` (73)
2. `Show HN: rn-shipyard – Local Expo builds and store uploads via fastlane` (71)
3. `Show HN: rn-shipyard – Expo builds and store uploads on your own Mac` (68)

Option 1 states the angle, option 2 the mechanism, option 3 is the plainest. Pick one; I would use 3 on HN and keep the "queue" wording for the first sentence of the comment.

## First comment (about 230 words)

```text
Hi HN, I'm Luca. I build Expo apps solo, and I got tired of waiting for cloud builds to start. On EAS's free plan builds can sit in a shared queue, and priority comes with a paid plan (pricing: https://expo.dev/pricing). Meanwhile my Mac was idle and perfectly able to build the thing.

rn-shipyard is a small MIT CLI that reads your existing eas.json and Expo config, generates a readable Fastfile, and runs expo prebuild + fastlane locally. `rn-shipyard submit` uploads straight from your machine (pilot for App Store Connect, supply for Google Play). No Expo account, no EAS project. Credentials are the standard ones: fastlane match for iOS, a keystore you own for Android.

I know `eas build --local` exists. As of eas-cli 18.1.0 it needs an Expo login and a linked project, is marked experimental in its help, and `eas submit` still runs on Expo's servers. That's the gap I wanted to close.

Also in there: `doctor` checks your Mac and prints the fix command for each missing piece, every command has --json and stable exit codes, and secrets are redacted from build output.

Limits, up front: macOS only, no OTA updates, no Windows/Linux, no monorepos, platforms build one after the other. It's a new project (0.1.0) and EAS is the mature product. Hosted builds are on my roadmap for people without a Mac.

Not affiliated with or endorsed by Expo.

What breaks on your setup? That's the feedback I want most. Docs: https://lamazzing.github.io/rn-shipyard/
```

## Notes for the owner

- Reply to every comment in the first two hours, factually. If someone says EAS builds start fast for them, agree: queue time varies and this is about not depending on it.
- Do not quote wait times or prices. Link the pricing page if asked.
- Have `npx rn-shipyard doctor` verified from a clean Mac before posting (see `repo-settings.md`).
- Post on a weekday, US morning, and avoid posting the other launch posts in the same hour.

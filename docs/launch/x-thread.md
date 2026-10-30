> **DRAFT. Not posted. Owner posts by hand.**

# X thread (7 posts, each 270 characters or fewer)

Attach the demo GIF (see `demo-script.md`) to post 1. Posts 2 to 7 are text only, except that the terminal screenshot of `doctor` output can go on post 3. Put the repo link in the last post, and in a reply to post 1 if links hurt reach in your experience.

**1 (standalone)**
```text
I got tired of waiting for Expo cloud builds to start, so I wrote rn-shipyard: a CLI that builds and submits iOS and Android apps from your own Mac with fastlane. No queue, no Expo account, MIT. Open source today.
```

**2**
```text
How it works: it reads your existing eas.json and app config (never edits them), runs expo prebuild, then fastlane/Gradle locally. Output streams live. `submit` uploads the .ipa and .aab straight to App Store Connect and Google Play.
```

**3**
```text
Start with `npx rn-shipyard doctor`. It checks Xcode, JDK, Android SDK, Fastlane, your Expo project and signing, and prints the exact command that fixes each missing piece.
```

**4**
```text
Credentials are the standard kind: fastlane match for iOS, a keystore you own for Android (you can import the one from `eas credentials`). It writes a readable Fastfile you can run yourself. Secrets are redacted from build output.
```

**5**
```text
Why not `eas build --local`? As of eas-cli 18.1.0 it needs an Expo login and a linked project, its help marks it experimental, and `eas submit` runs on Expo's servers. rn-shipyard needs none of that.
```

**6**
```text
Limits: macOS only, no OTA updates, no Windows/Linux, no monorepos, platforms build one after the other. It is 0.1.0. EAS is the mature product and the better fit if you have no Mac. Hosted builds are on my roadmap.
```

**7**
```text
Repo: https://github.com/lamazzing/rn-shipyard
Docs: https://lamazzing.github.io/rn-shipyard/
Tell me what breaks on your project. Every command has --json and exit codes if you want to script it. Not affiliated with or endorsed by Expo.
```

# ARCHITECTURE.md — rn-shipyard

## Stack
- Language: TypeScript (strict mode)
- Runtime: Node.js >= 18
- CLI framework: Commander.js
- Build tool: tsup (bundle to dist/)
- Package manager: npm
- Template engine: EJS (for Fastlane file generation)
- Testing: vitest
- Terminal UI: chalk, ora (spinner), cli-table3
- Under the hood: Fastlane (Ruby), Expo CLI, Xcode/Gradle

## Project Structure
```
rn-shipyard/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── src/
│   ├── index.ts                    # Entry point, Commander setup
│   ├── commands/
│   │   ├── doctor.ts               # doctor command handler
│   │   ├── init.ts                 # init command handler
│   │   ├── build.ts                # build command handler
│   │   ├── submit.ts               # submit command handler
│   │   └── history.ts              # history command handler
│   ├── core/
│   │   ├── config.ts               # .shipyard/config.json manager
│   │   ├── history.ts              # .shipyard/history.json manager
│   │   ├── paths.ts                # portable (relative / ~) path storage, .shipyard/.gitignore
│   │   ├── eas-parser.ts           # eas.json (+ build-profile env) and app.json / app.config.* parser
│   │   ├── version-check.ts        # Version bump detection
│   │   └── output.ts               # Formatter (text tables / JSON)
│   ├── platforms/
│   │   ├── ios/
│   │   │   ├── build.ts            # iOS build via Fastlane gym
│   │   │   ├── submit.ts           # iOS submit via Fastlane pilot
│   │   │   ├── signing.ts          # Match setup and cert management
│   │   │   ├── workspace.ts        # Detect the single ios/*.xcworkspace + scheme
│   │   │   └── doctor.ts           # iOS-specific env checks
│   │   └── android/
│   │       ├── build.ts            # Android build via Fastlane gradle
│   │       ├── submit.ts           # Android submit via Fastlane supply
│   │       ├── keystore.ts         # Keystore generation
│   │       ├── shell-env.ts        # /bin/sh dotted-env-var preflight (Gradle signing)
│   │       └── doctor.ts           # Android-specific env checks
│   ├── fastlane/
│   │   ├── generator.ts            # Generate Fastfile, Matchfile, Appfile
│   │   └── runner.ts               # Execute fastlane commands, stream output
│   └── utils/
│       ├── shell.ts                # Shell command execution with streaming
│       ├── logger.ts               # Logging with JSON/text modes; collects warnings
│       ├── signals.ts              # SIGINT/SIGTERM/SIGHUP + crash handlers: kill children, then restore files
│       ├── native-dirs.ts          # ios/ android/ tracked-in-git detection (prebuild skip rule)
│       └── errors.ts               # Error types with code/message/fix
├── templates/
│   ├── Fastfile.ejs                # Fastfile template
│   ├── Matchfile.ejs               # Matchfile template
│   └── Appfile.ejs                 # Appfile template
└── tests/
    ├── core/
    │   ├── config.test.ts
    │   ├── history.test.ts
    │   ├── eas-parser.test.ts
    │   └── version-check.test.ts
    ├── commands/
    │   ├── doctor.test.ts
    │   ├── init.test.ts
    │   ├── build.test.ts
    │   ├── submit.test.ts
    │   └── history.test.ts
    └── fixtures/
        ├── eas.json
        ├── app.json
        └── config.json
```

## Data Model

### eas.json (READ ONLY — user's existing file)
```json
{
  "build": {
    "development": {
      "distribution": "internal",
      "ios": { "simulator": true },
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "distribution": "store",
      "ios": { "autoIncrement": true },
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "user@example.com",
        "ascAppId": "1234567890",
        "appleTeamId": "XXXXXXXXXX"
      },
      "android": {
        "serviceAccountKeyPath": "./play-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

### app.json / app.config.* (READ ONLY — user's existing file)
Resolution order: `app.config.ts|js|mjs|cjs` if present, evaluated with `npx expo config --json` (cwd = project,
60s timeout, env = process env + `eas.json` `build.<profile>.env`; `.env` is loaded by expo as in prebuild, so
EXPO_NO_DOTENV is not set); otherwise `app.json`. `AppConfig.source` records the file name for warnings. Errors:
`MISSING_CONFIG_APP` (exit 2), `INVALID_APP_CONFIG`, `APP_CONFIG_EVAL_FAILED` (exit 1). The profile env (`extends`
resolved, cycles guarded, rn-shipyard-owned secret names dropped) also goes to `expo prebuild` and the fastlane
env of both platform builds; rn-shipyard's own values win.
```json
{
  "expo": {
    "name": "MyApp",
    "slug": "my-app",
    "version": "1.2.0",
    "ios": {
      "bundleIdentifier": "com.example.myapp",
      "buildNumber": "42"
    },
    "android": {
      "package": "com.example.myapp",
      "versionCode": 42
    }
  }
}
```

### .shipyard/config.json (created by init)
```json
{
  "version": "1.0.0",
  "createdAt": "2026-02-23T14:30:00Z",
  "platforms": {
    "ios": {
      "enabled": true,
      "signingMethod": "match",
      "matchGitUrl": "git@github.com:user/certs.git",
      "matchType": "appstore",
      "teamId": "XXXXXXXXXX",
      "bundleId": "com.example.myapp"
    },
    "android": {
      "enabled": true,
      "keystorePath": ".shipyard/android/release.keystore",
      "keystoreAlias": "release",
      "credentialsPath": "~/.config/myapp/android-upload.json",
      "serviceAccountKeyPath": "./play-service-account.json"
    }
  },
  "outputDir": "./output"
}
```

**Path semantics.** `keystorePath`, `credentialsPath` and `serviceAccountKeyPath` are stored portably so the file
can be committed or shared: inside the project root they are project-relative (`.shipyard/android/release.keystore`),
under the home directory they are `~/...`, anything else stays absolute. `readConfig` resolves them to absolute paths
at read time; old configs with absolute paths keep working. `writeConfig` converts on write. (`src/core/paths.ts`)
`credentialsPath` points to a JSON file OUTSIDE the repo: `{ "keystorePassword", "keyAlias", "keyPassword" }`.
`ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_PASSWORD` env vars override the file. Passwords are never written to
`.shipyard/`, passed on the fastlane argv, or left unredacted in logs/history (fastlane echoes the Gradle command
line, so `exec` has a `redact` option).

Use an existing keystore (for example the upload key Expo holds) instead of generating one:
`rn-shipyard init --platform android --android-keystore <jks> --android-credentials <json> --android-last-version-code <n>`.

### .shipyard/version-code.json (Android versionCode counter, safe to commit)
```json
{ "android": { "lastUsed": 4 } }
```

**versionCode rule (a code is never reused):**
```
lastUsed = max(version-code.json android.lastUsed, highest versionCode of a successful android build in history.json)
next     = max(app.json android.versionCode ?? 1, lastUsed + 1)
```
`build --version-code <n>` overrides the rule but must be greater than `lastUsed`. The counter advances only after
a successful build. `build` writes the code into the GENERATED `android/app/build.gradle` (app.json is never
modified) and into the artifact name. Seed the counter from EAS with `init --android-last-version-code <n>`
(`npx eas-cli build:version:get -p android -e production` shows EAS's remote counter).

### Submit settings (eas.json `submit.<profile>.android`, read only)
`serviceAccountKeyPath`, `track` (default `internal`), `releaseStatus` (default `draft`). `SUPPLY_JSON_KEY` env wins.
`rn-shipyard submit --dry-run` validates the inputs and prints the exact fastlane command without running it
and without writing history. `--dry-run` covers iOS too: it checks the `.ipa` exists and that App Store Connect
credentials are available (eas.json `appleId`/`FASTLANE_USER` plus `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` or
`FASTLANE_PASSWORD`, or an API key via `APP_STORE_CONNECT_API_KEY_KEY_ID`, `_ISSUER_ID`, `_KEY`/`_KEY_FILEPATH`).
Dry-run `--json`: `{ success, dryRun: true, cwd, platforms: { ios?, android? } }`, each platform
`{ status: "ok" | "skipped" | "error", artifactPath, command | null, problems[] }`. Every requested platform appears;
`skipped` means it is not enabled in config. Exit 0 only if no platform has `error` and at least one is `ok`.

### .shipyard/.gitignore (created by init)
rn-shipyard's own ignore file: `history.json`, `*.keystore`, `*.jks`, `credentials.json`, `*-credentials.json`,
`*.log`, `logs/`. Created if missing; if it exists only missing entries are appended, user edits are kept.

### .shipyard/history.json (written by build/submit)
`artifactPath` is stored project-relative (or `~/...`), never with the user's home prefix; legacy absolute paths are
still resolved. Machine-local: ignored by `.shipyard/.gitignore`.

```json
{
  "entries": [
    {
      "id": "a1b2c3d4",
      "timestamp": "2026-02-23T14:30:00Z",
      "command": "build",
      "profile": "production",
      "platforms": {
        "ios": {
          "status": "success",
          "version": "1.2.0",
          "buildNumber": "42",
          "artifactPath": "output/MyApp-1.2.0-42.ipa",
          "durationSeconds": 185,
          "error": null
        },
        "android": {
          "status": "success",
          "version": "1.2.0",
          "versionCode": 42,
          "artifactPath": "output/MyApp-1.2.0-42.aab",
          "durationSeconds": 120,
          "error": null
        }
      }
    },
    {
      "id": "e5f6g7h8",
      "timestamp": "2026-02-23T14:35:00Z",
      "command": "submit",
      "profile": "production",
      "platforms": {
        "ios": {
          "status": "success",
          "version": "1.2.0",
          "buildNumber": "42",
          "durationSeconds": 60,
          "error": null
        },
        "android": {
          "status": "skipped",
          "version": "1.2.0",
          "versionCode": 42,
          "durationSeconds": 0,
          "error": "No service account configured. Set serviceAccountKeyPath in eas.json submit config."
        }
      }
    }
  ]
}
```

## Fastlane Integration

### Generated Fastfile structure
```ruby
default_platform(:ios)

platform :ios do
  desc "Build iOS app"
  lane :build do |options|
    match(type: "appstore", readonly: true)
    gym(
      workspace: options[:workspace],   # detected from ios/*.xcworkspace at build time
      scheme: options[:scheme],
      export_method: "app-store",
      output_directory: options[:output_dir] || "./output",
      output_name: options[:output_name]
    )
  end

  desc "Submit iOS app to App Store Connect"
  lane :submit do |options|
    pilot(
      ipa: options[:ipa_path],
      skip_waiting_for_build_processing: true
    )
  end
end

platform :android do
  desc "Build Android app"
  lane :build do |options|
    gradle(
      project_dir: "android",
      task: "bundle",
      build_type: "Release",
      properties: {
        "android.injected.signing.store.file" => options[:keystore_path],
        "android.injected.signing.store.password" => options[:keystore_password],
        "android.injected.signing.key.alias" => options[:key_alias],
        "android.injected.signing.key.password" => options[:key_password]
      }
    )
  end

  desc "Submit Android app to Google Play"
  lane :submit do |options|
    supply(
      aab: options[:aab_path],
      track: options[:track] || "internal",
      json_key: options[:service_account_key]
    )
  end
end
```

### Command → File Read/Write Matrix

| Command  | Reads                                         | Writes                                              |
|----------|-----------------------------------------------|-----------------------------------------------------|
| doctor   | system env (Xcode, SDK, etc.)                 | nothing (stdout only)                               |
| init     | eas.json, app.json/app.config.*               | .shipyard/config.json, .shipyard/android/*.keystore, fastlane/* |
| build    | eas.json, .shipyard/config.json, .shipyard/history.json, app.json | output/*.ipa, output/*.aab, .shipyard/history.json |
| submit   | .shipyard/config.json, .shipyard/history.json, output/* | .shipyard/history.json                             |
| history  | .shipyard/history.json                        | nothing (stdout only)                               |

## External Services & Environment

### Required tools (checked by doctor)
| Tool              | Required For    | Minimum Version | Install Command                       |
|-------------------|-----------------|-----------------|---------------------------------------|
| Node.js           | Core runtime    | >= 18           | `brew install node`                   |
| Ruby              | Fastlane        | >= 2.7          | System Ruby or `brew install ruby`    |
| Fastlane          | Build + submit  | latest          | `gem install fastlane`                |
| CocoaPods         | iOS native deps | latest          | `gem install cocoapods`               |
| Xcode + CLI tools | iOS builds      | >= 15           | App Store + `xcode-select --install`  |
| Android SDK       | Android builds  | API 34+         | Android Studio or `sdkmanager`        |
| JDK               | Android + keytool | >= 11         | `brew install openjdk`                |
| Expo CLI          | Prebuild        | latest          | `npx expo` (no global install needed) |

### Environment variables
| Variable                                        | Required      | Used By      | Description                              | Format                         |
|-------------------------------------------------|---------------|--------------|------------------------------------------|--------------------------------|
| `MATCH_PASSWORD`                                | iOS           | init, build  | Encryption password for Match cert repo  | Any string                     |
| `MATCH_GIT_URL`                                 | iOS           | init, build  | Git URL for Match certificate storage    | `git@github.com:user/certs.git`|
| `APPLE_TEAM_ID`                                 | iOS           | init, build  | Apple Developer Team ID                  | 10-char alphanumeric           |
| `FASTLANE_USER`                                 | iOS submit    | submit       | Apple ID email for App Store Connect     | email                          |
| `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`  | iOS submit    | submit       | App-specific password for 2FA            | `xxxx-xxxx-xxxx-xxxx`          |
| `ANDROID_KEYSTORE_PASSWORD`                     | Android       | build        | Release keystore password                | Any string                     |
| `ANDROID_KEY_PASSWORD`                           | Android       | build        | Release key password                     | Any string                     |
| `SUPPLY_JSON_KEY`                               | Android submit (optional) | submit | Path to Google Play service account JSON | File path              |

Note: Many of these can alternatively be read from `eas.json` or `.shipyard/config.json`. Environment variables take precedence.

### .gitignore additions
```
# rn-shipyard
.shipyard/android/*.keystore
.shipyard/android/*.jks
*.jks
*.keystore
credentials.json
fastlane/report.xml
fastlane/README.md
output/
*.ipa
*.aab
*.apk
```

## Error Handling

### Exit codes
| Code | Meaning                                   |
|------|-------------------------------------------|
| 0    | Success (all platforms succeeded)         |
| 1    | Error (at least one platform failed)      |
| 2    | Missing configuration (run init first)    |

### JSON error format
```json
{
  "success": false,
  "error": {
    "code": "IOS_SIGNING_FAILED",
    "message": "Code signing failed: no matching provisioning profile found",
    "fix": "Run 'rn-shipyard init --platform ios' to set up code signing"
  },
  "platforms": {
    "ios": { "status": "error", "error": { "code": "...", "message": "...", "fix": "..." } },
    "android": { "status": "success", "artifactPath": "output/MyApp.aab" }
  }
}
```

### JSON success format
```json
{
  "success": true,
  "platforms": {
    "ios": { "status": "success", "artifactPath": "output/MyApp-1.2.0-42.ipa", "durationSeconds": 185 },
    "android": { "status": "success", "artifactPath": "output/MyApp-1.2.0-42.aab", "durationSeconds": 120 }
  },
  "prebuild": { "ios": { "action": "generated" }, "android": { "action": "skipped_tracked" } },
  "warnings": []
}
```
`prebuild.<platform>.action` is `generated`, `skipped_tracked` (native folder tracked in git, prebuild not run) or `refused` (folder exists and is untracked and not git-ignored, `NATIVE_DIR_UNTRACKED`, or the project is not under git, `NATIVE_DIR_NOT_IN_GIT`; adds `error: { code, message, fix }`). With `build --submit --json` the submit result is nested under `submit`.

### Process control (build)
- `exec()` accepts `detached: true`: the child gets its own process group. `expo prebuild` and `fastlane` use it.
- `exec()` takes `interactive`: `true` inherits stdin (after running every `registerStdinReleaser` hook, which closes the readline prompter); `false` gives no stdin and sets `CI=1`, `FASTLANE_IS_INTERACTIVE=false`, `SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA=true`. The flag comes from `isInteractive()` (`src/utils/interactive.ts`) and is threaded to every `exec`/`runFastlane` call.
- Terminal writes go through `safeWrite` (`src/utils/terminal.ts`); `EPIPE`/`EIO` mark the stream dead instead of crashing. `registerCleanup(fn, syncFn)` pairs the async restore with a synchronous one run from `process.on('exit')`.
- `src/utils/signals.ts` handles SIGINT/SIGTERM/SIGHUP: `killActiveChildren()` (SIGTERM to the group, SIGKILL after a grace period, wait for exit), then `runCleanups()` (restore `package.json`/lockfiles), then exit 130/143/129. After the kill, pending `exec()` calls never resolve, so the interrupted flow cannot continue.
- `src/utils/native-dirs.ts` decides per platform whether prebuild may run (`absent`, `ignored`, `tracked`, `untracked`, `not-git`) with `git ls-files` and `git check-ignore`; prebuild runs only for `absent` and `ignored`.

## Conventions
- All file I/O uses async/await
- Shell commands stream output in real-time (child_process.spawn, not exec)
- Config files use JSON (not YAML)
- Templates use EJS for Fastlane file generation
- No classes — functional modules with explicit dependencies
- Tests use vitest with mocked shell layer
- Every command supports --json and --non-interactive flags
- Platform builds are isolated — one failure must not prevent the other

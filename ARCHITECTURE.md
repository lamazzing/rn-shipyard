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
│   │   ├── eas-parser.ts           # eas.json + app.json parser
│   │   ├── version-check.ts        # Version bump detection
│   │   └── output.ts               # Formatter (text tables / JSON)
│   ├── platforms/
│   │   ├── ios/
│   │   │   ├── build.ts            # iOS build via Fastlane gym
│   │   │   ├── submit.ts           # iOS submit via Fastlane pilot
│   │   │   ├── signing.ts          # Match setup and cert management
│   │   │   └── doctor.ts           # iOS-specific env checks
│   │   └── android/
│   │       ├── build.ts            # Android build via Fastlane gradle
│   │       ├── submit.ts           # Android submit via Fastlane supply
│   │       ├── keystore.ts         # Keystore generation
│   │       └── doctor.ts           # Android-specific env checks
│   ├── fastlane/
│   │   ├── generator.ts            # Generate Fastfile, Matchfile, Appfile
│   │   └── runner.ts               # Execute fastlane commands, stream output
│   └── utils/
│       ├── shell.ts                # Shell command execution with streaming
│       ├── logger.ts               # Logging with JSON/text modes
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

### app.json (READ ONLY — user's existing file)
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
      "serviceAccountKeyPath": "./play-service-account.json"
    }
  },
  "outputDir": "./output"
}
```

### .shipyard/history.json (written by build/submit)
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
      workspace: "ios/#{options[:app_name]}.xcworkspace",
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
| init     | eas.json, app.json/app.config.js              | .shipyard/config.json, .shipyard/android/*.keystore, fastlane/* |
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
  }
}
```

## Conventions
- All file I/O uses async/await
- Shell commands stream output in real-time (child_process.spawn, not exec)
- Config files use JSON (not YAML)
- Templates use EJS for Fastlane file generation
- No classes — functional modules with explicit dependencies
- Tests use vitest with mocked shell layer
- Every command supports --json and --non-interactive flags
- Platform builds are isolated — one failure must not prevent the other

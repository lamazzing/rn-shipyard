# PRODUCT.md — rn-shipyard

## Vision
Indie Expo developers can build and submit their iOS and Android apps locally from their Mac with a single CLI command, so they don't need to depend on or pay for Expo's EAS cloud service.

## Target User
Indie React Native / Expo developers on macOS who want to build and submit to App Store and Google Play without cloud services.

## Commands

### 1. `rn-shipyard doctor`
Purpose: Diagnose environment readiness for local builds.

Shows:
- Checklist of required tools with pass/fail status
- Version numbers for detected tools
- Actionable fix instructions for failed checks

Flags:
- `--platform ios|android|all` (default: all) — filter checks by platform
- `--json` — output structured JSON

Checks:
- Node.js (>=18)
- Ruby (>=2.7)
- Fastlane
- CocoaPods (iOS)
- Xcode + xcodebuild (iOS)
- Android SDK + ANDROID_HOME (Android)
- JDK + keytool (Android)
- Expo CLI

Exit: 0 if all pass, 1 if any fail.

### 2. `rn-shipyard init`
Purpose: One-time project setup — configure signing, generate Fastlane files, create .shipyard config.

Reads:
- `eas.json` — imports build profiles and submit config
- `app.json` / `app.config.js|ts|mjs|cjs` — reads app name, version, bundle IDs (dynamic configs evaluated with `npx expo config --json`; `eas.json` build-profile `env` applied)

Flags:
- `--platform ios|android|all` (default: all) — set up specific platform
- `--json` — output structured JSON
- `--non-interactive` — fail with clear errors instead of prompting

iOS setup:
- Prompts for Apple Team ID (or reads from eas.json / env)
- Prompts for Match git repo URL for certificate storage
- Runs `fastlane match appstore` to fetch/create certs and profiles
- Generates Matchfile

Android setup:
- Generates release keystore via keytool (if missing)
- Prompts for keystore password (or reads from env)
- Detects Google Play service account JSON path from eas.json

Both:
- Generates `fastlane/Fastfile` with build + submit lanes
- Generates `fastlane/Appfile`
- Creates `.shipyard/config.json`
- Updates `.gitignore` with shipyard entries

Exit: 0 success, 1 error, 2 missing required values in non-interactive mode.

### 3. `rn-shipyard build`
Purpose: Build the app locally for one or both platforms.

Reads:
- `eas.json` — build profile settings
- `.shipyard/config.json` — signing and platform config
- `.shipyard/history.json` — for version bump check
- `app.json` / `app.config.js` — current version info

Flags:
- `--platform ios|android|all` (default: all)
- `--profile <name>` (default: production)
- `--submit` — build then submit in one shot
- `--skip-version-check` — bypass version bump warning
- `--json` — output structured JSON
- `--non-interactive` — warn but don't block on version check

Behavior:
- Runs `npx expo prebuild --clean` to generate/update native projects
- Checks version against last successful build in history; warns if same
- Builds each platform independently — if one fails, the other continues
- iOS: invokes `fastlane ios build` to produce .ipa
- Android: invokes `fastlane android build` to produce .aab
- Moves artifacts to `output/` directory with descriptive names
- Records build entry in `.shipyard/history.json`
- If `--submit` flag: triggers submit after successful builds

Exit: 0 all platforms succeeded, 1 any platform failed, 2 not initialized.

### 4. `rn-shipyard submit`
Purpose: Submit built artifacts to app stores.

Reads:
- `.shipyard/config.json` — store credentials and config
- `.shipyard/history.json` — finds latest build artifacts
- `output/` — build artifacts

Flags:
- `--platform ios|android|all` (default: all)
- `--json` — output structured JSON
- `--non-interactive` — skip confirmations

Behavior:
- iOS: uploads .ipa to App Store Connect via Fastlane pilot
- Android: uploads .aab to Google Play via Fastlane supply (if service account configured)
- Android without service account: skips with clear message explaining how to configure
- Each platform runs independently — one failure doesn't block the other
- Updates history entry with submit status

Exit: 0 all succeeded, 1 any failed, 2 not initialized or no artifacts.

### 5. `rn-shipyard history`
Purpose: Show deployment history log.

Reads:
- `.shipyard/history.json`

Flags:
- `--platform ios|android` — filter by platform
- `--limit <n>` (default: 10) — number of entries to show
- `--json` — output structured JSON

Shows:
- Formatted table: date, command, profile, platform, version, build number, status, duration
- Or JSON array in --json mode
- If no history: "No builds yet. Run 'rn-shipyard build' to get started."

Exit: 0 always.

## Core User Flow

1. Dev installs: `npm install -g rn-shipyard`
2. Dev runs `rn-shipyard doctor` → sees what's missing in their env
3. Dev fixes any issues flagged by doctor
4. Dev runs `rn-shipyard init --platform all` in their Expo project → detects eas.json, sets up Fastlane, code signing, keystore
5. Dev runs `rn-shipyard build --platform all --profile production` → expo prebuild runs, Fastlane builds both platforms → version check warns if needed → if iOS fails, Android still completes → artifacts land in output/ → history entry recorded
6. Dev runs `rn-shipyard submit --platform all` → iOS .ipa uploaded to App Store Connect → Android .aab uploaded to Google Play (if configured) → history entry updated
7. Dev runs `rn-shipyard history` → sees past builds/submissions

## Out of Scope (V1)
1. EAS Update (OTA updates) — different system entirely
2. Remote/cloud builds — opposite of the point
3. Windows/Linux support — Mac only (Xcode requirement)
4. Monorepo support — standard Expo projects only
5. Custom Fastlane lanes — power user feature for V2
6. Build caching — optimization, not core
7. Parallel iOS+Android builds — nice to have, sequential in V1
8. Push notifications setup — separate concern
9. CI/CD integration — users run locally for V1
10. Config migration wizard — just reads eas.json directly
11. Multiple team/org support — indie dev = solo
12. Build webhooks/callbacks — cloud feature
13. Auto version bumping — warn only, don't modify user files
14. GUI / TUI dashboard — CLI only

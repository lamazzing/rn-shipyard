# TASKS.md — rn-shipyard

## Dependency Graph

```
Task 1:  Scaffold ─────────────────────────────────┐
Task 2:  Config Layer ──────┐ (needs 1)            │
Task 3:  Doctor ────────────┤ (needs 1)            │
Task 4:  Fastlane Generator ┤ (needs 2)            │
Task 5:  Init Command ──────┤ (needs 2, 4)         │
Task 6:  Build Command ─────┤ (needs 2, 4, 5)      │
Task 7:  Submit Command ────┤ (needs 2, 4, 6)      │
Task 8:  History Command ───┤ (needs 2)            │
Task 9:  CLI Polish ────────┤ (needs 3-8)          │
Task 10: Package + Publish ─┘ (needs 9)            │
                                                    │
All tasks trace back to Task 1 ─────────────────────┘
```

---

## Task 1: Project Scaffold + CLI Framework
Dependencies: none
Creates: package.json, tsconfig.json, tsup.config.ts, src/index.ts, src/utils/shell.ts, src/utils/logger.ts, src/utils/errors.ts, src/core/output.ts
Requires: nothing

- [ ] Initialize npm project with `package.json` (name: rn-shipyard, bin: rn-shipyard)
- [ ] Configure TypeScript with `tsconfig.json` (strict mode, ES2022 target, NodeNext module)
- [ ] Configure tsup with `tsup.config.ts` to bundle `src/index.ts` to `dist/index.js` with shebang `#!/usr/bin/env node`
- [ ] Install dependencies: commander, chalk, ora, cli-table3, ejs, uuid
- [ ] Install dev dependencies: typescript, tsup, vitest, @types/node
- [ ] Create `src/index.ts` with Commander setup: 5 commands (doctor, init, build, submit, history) as stubs that print "Not implemented yet"
- [ ] Register global flags: `--json` (boolean) and `--non-interactive` (boolean) on the root program
- [ ] Create `src/utils/shell.ts` — async function `exec(cmd, args, opts)` that spawns a child process with streaming stdout/stderr, supports timeout, and returns `{ exitCode, stdout, stderr }`
- [ ] Create `src/utils/logger.ts` — logger with `info()`, `success()`, `warn()`, `error()` methods; respects `--json` flag (buffers output for JSON mode, prints immediately for text mode); uses chalk colors in text mode
- [ ] Create `src/utils/errors.ts` — `ShipyardError` class extending Error with `code: string`, `fix: string` fields; exit code mapping function
- [ ] Create `src/core/output.ts` — `formatResult(data, jsonMode)` that returns JSON string or formatted cli-table3 table
- [ ] Add npm scripts: `build` (tsup), `dev` (tsup --watch), `test` (vitest run), `lint` (tsc --noEmit)

Verify: `npm run build && node dist/index.js --help` shows all 5 commands with --json and --non-interactive flags; `node dist/index.js doctor` prints "Not implemented yet"
Commit: "feat: scaffold project with CLI framework and core utilities"

---

## Task 2: Config Layer — EAS Parser, Config Manager, History Manager
Dependencies: Task 1
Creates: src/core/eas-parser.ts, src/core/config.ts, src/core/history.ts, src/core/version-check.ts, tests/core/*.test.ts, tests/fixtures/*
Requires: src/utils/errors.ts, src/utils/logger.ts

- [ ] Create `src/core/eas-parser.ts`:
  - `parseEasConfig(projectDir)` — reads `eas.json`, returns typed build profiles and submit config
  - `parseAppConfig(projectDir)` — reads `app.json` or evaluates `app.config.js`, returns { name, slug, version, ios: { bundleIdentifier, buildNumber }, android: { package, versionCode } }
  - Throws ShipyardError with fix message if files are missing
- [ ] Create `src/core/config.ts`:
  - `readConfig(projectDir)` — reads `.shipyard/config.json`, validates schema, returns typed config
  - `writeConfig(projectDir, config)` — writes `.shipyard/config.json`, creates `.shipyard/` dir if missing
  - `configExists(projectDir)` — returns boolean
  - TypeScript interface `ShipyardConfig` matching the schema in ARCHITECTURE.md
- [ ] Create `src/core/history.ts`:
  - `readHistory(projectDir)` — reads `.shipyard/history.json`, returns entries array (empty array if file missing)
  - `appendHistory(projectDir, entry)` — appends entry with auto-generated id and timestamp
  - `queryHistory(projectDir, { platform?, limit? })` — filter and limit entries
  - TypeScript interface `HistoryEntry` matching schema in ARCHITECTURE.md
- [ ] Create `src/core/version-check.ts`:
  - `checkVersion(projectDir)` — compares current app.json version + buildNumber/versionCode against last successful build in history
  - Returns `{ shouldWarn: boolean, message: string, lastBuild?: HistoryEntry }`
- [ ] Create test fixtures: `tests/fixtures/eas.json`, `tests/fixtures/app.json`, `tests/fixtures/config.json` with realistic sample data
- [ ] Write unit tests for eas-parser: valid eas.json, missing fields, missing file, app.config.js support
- [ ] Write unit tests for config manager: read existing, write new, missing directory auto-create, invalid schema
- [ ] Write unit tests for history manager: append entry, query with platform filter, query with limit, empty history
- [ ] Write unit tests for version-check: same version warns, different version passes, no history passes, different build number passes

Verify: `npx vitest run` — all tests pass
Commit: "feat: add config layer — EAS parser, config manager, history, version check"

---

## Task 3: Doctor Command
Dependencies: Task 1
Creates: src/commands/doctor.ts, src/platforms/ios/doctor.ts, src/platforms/android/doctor.ts, tests/commands/doctor.test.ts
Requires: src/utils/shell.ts, src/utils/logger.ts, src/core/output.ts

- [ ] Create `src/platforms/ios/doctor.ts` — check functions:
  - `checkXcode()` — runs `xcodebuild -version`, parses version, returns { name: "Xcode", passed, version, fix }
  - `checkCocoaPods()` — runs `pod --version`, returns check result
  - `checkFastlane()` — runs `fastlane --version`, returns check result (shared with Android)
- [ ] Create `src/platforms/android/doctor.ts` — check functions:
  - `checkAndroidSdk()` — checks ANDROID_HOME env var exists and directory is valid, returns check result
  - `checkJdk()` — runs `java -version`, parses version (>= 11), returns check result
  - `checkKeytool()` — runs `keytool -help`, returns check result
- [ ] Create common checks in doctor command:
  - `checkNode()` — runs `node -v`, parses version (>= 18), returns check result
  - `checkRuby()` — runs `ruby -v`, parses version (>= 2.7), returns check result
  - `checkExpoCli()` — runs `npx expo --version`, returns check result
- [ ] Each check returns: `{ name: string, passed: boolean, version?: string, required: string, fix?: string }`
- [ ] Create `src/commands/doctor.ts`:
  - Collects checks based on --platform flag (all, ios, android)
  - Runs all checks concurrently (Promise.allSettled)
  - Outputs results as formatted table (name | status | version | fix) or JSON
  - Exits 0 if all pass, 1 if any fail
- [ ] Wire doctor command into src/index.ts (replace stub)
- [ ] Write tests with mocked shell.exec

Verify: `npm run build && node dist/index.js doctor --json` returns valid JSON array of check results
Commit: "feat: implement doctor command with platform-specific environment checks"

---

## Task 4: Fastlane File Generator + Runner
Dependencies: Task 2
Creates: src/fastlane/generator.ts, src/fastlane/runner.ts, templates/Fastfile.ejs, templates/Matchfile.ejs, templates/Appfile.ejs, tests/fastlane/generator.test.ts
Requires: src/core/config.ts, src/core/eas-parser.ts, src/utils/shell.ts

- [ ] Create `templates/Fastfile.ejs` — EJS template generating Ruby Fastfile with:
  - iOS build lane using gym (parameterized: workspace, scheme, export_method, output_directory, output_name)
  - iOS submit lane using pilot (parameterized: ipa_path, skip_waiting_for_build_processing)
  - Android build lane using gradle (parameterized: project_dir, task, build_type, signing properties)
  - Android submit lane using supply (parameterized: aab_path, track, json_key)
  - Match call in iOS build lane (type, readonly)
- [ ] Create `templates/Matchfile.ejs` — EJS template with git_url, type, app_identifier, team_id
- [ ] Create `templates/Appfile.ejs` — EJS template with app_identifier, apple_id, team_id, package_name
- [ ] Create `src/fastlane/generator.ts`:
  - `generateFastfile(projectDir, config)` — renders Fastfile.ejs with config values, writes to `fastlane/Fastfile`
  - `generateMatchfile(projectDir, config)` — renders Matchfile.ejs, writes to `fastlane/Matchfile`
  - `generateAppfile(projectDir, config)` — renders Appfile.ejs, writes to `fastlane/Appfile`
  - `generateAll(projectDir, config)` — calls all three, creates `fastlane/` dir if missing
- [ ] Create `src/fastlane/runner.ts`:
  - `runFastlane(lane, platform, options, { json, projectDir })` — spawns `fastlane <platform> <lane>` with options passed as command-line args
  - Streams stdout/stderr in real-time (text mode) or captures for JSON mode
  - Returns `{ success: boolean, exitCode: number, output: string, durationSeconds: number }`
  - Handles Fastlane not installed error with clear fix message
- [ ] Install ejs as dependency (already in Task 1 deps list)
- [ ] Write tests for generator: verify rendered Fastfile contains expected lane names and parameters; verify Matchfile contains git URL; verify Appfile contains bundle ID

Verify: `npx vitest run -- generator` — tests pass
Commit: "feat: add Fastlane file generator and runner"

---

## Task 5: Init Command — iOS Signing + Android Keystore
Dependencies: Task 2, Task 4
Creates: src/commands/init.ts, src/platforms/ios/signing.ts, src/platforms/android/keystore.ts
Requires: src/core/eas-parser.ts, src/core/config.ts, src/fastlane/generator.ts, src/fastlane/runner.ts, src/utils/shell.ts, src/utils/logger.ts

- [ ] Create `src/platforms/ios/signing.ts`:
  - `setupMatch(opts: { gitUrl, teamId, bundleId, password })` — runs `fastlane match appstore` with env vars set
  - Validates Match git URL is accessible before running
  - Returns { success: boolean, error?: string }
- [ ] Create `src/platforms/android/keystore.ts`:
  - `generateKeystore(opts: { outputPath, alias, password, keyPassword, dname })` — runs `keytool -genkeypair -v -keystore <path> -alias <alias> -keyalg RSA -keysize 2048 -validity 10000`
  - Skips if keystore already exists at outputPath
  - Returns { created: boolean, path: string }
- [ ] Create `src/commands/init.ts`:
  - Parse eas.json + app.json to extract defaults (team ID, bundle ID, package name, service account path)
  - If `--platform` includes ios:
    - In interactive mode: prompt for Match git URL, Apple Team ID (prefill from eas.json/env)
    - In non-interactive mode: read from env vars (MATCH_GIT_URL, APPLE_TEAM_ID), exit 2 if missing
    - Call setupMatch
    - Generate Matchfile
  - If `--platform` includes android:
    - Generate keystore if missing (prompt for password in interactive, read ANDROID_KEYSTORE_PASSWORD env in non-interactive)
    - Detect service account path from eas.json submit config
  - Generate Fastfile and Appfile via generator
  - Write .shipyard/config.json with all collected settings
  - Append shipyard entries to .gitignore (if not already present)
  - Output summary: what was configured, what needs manual steps
- [ ] Use Node.js readline for interactive prompts (no external dependency)
- [ ] Wire init command into src/index.ts (replace stub)
- [ ] Write tests with mocked filesystem and shell (verify config.json is written correctly, Fastlane files generated)

Verify: `npm run build && node dist/index.js init --help` shows --platform, --json, --non-interactive flags
Commit: "feat: implement init command with iOS signing and Android keystore setup"

---

## Task 6: Build Command
Dependencies: Task 2, Task 4, Task 5
Creates: src/commands/build.ts, src/platforms/ios/build.ts, src/platforms/android/build.ts
Requires: src/core/config.ts, src/core/eas-parser.ts, src/core/history.ts, src/core/version-check.ts, src/fastlane/runner.ts, src/utils/shell.ts, src/utils/logger.ts

- [ ] Create `src/platforms/ios/build.ts`:
  - `buildIos(config, { profile, outputDir, appName, scheme })` — invokes `fastlane ios build` via runner with correct options
  - Resolves workspace path: `ios/<appName>.xcworkspace`
  - Returns `{ status: "success"|"error", artifactPath?: string, durationSeconds: number, error?: string }`
- [ ] Create `src/platforms/android/build.ts`:
  - `buildAndroid(config, { profile, outputDir, keystorePath, keystorePassword, keyAlias, keyPassword })` — invokes `fastlane android build` via runner
  - Returns same shape as iOS build result
- [ ] Create `src/commands/build.ts`:
  - Validate init has been run (check .shipyard/config.json exists), exit 2 if not
  - Read eas.json for profile settings, app.json for version info
  - Run version check: if shouldWarn, log warning (in non-interactive: warn and continue; in interactive: warn and continue)
  - Run `npx expo prebuild --clean` to generate native projects
  - Determine platforms to build from --platform flag and config.platforms.*.enabled
  - Build each platform sequentially, wrapped in try/catch:
    - iOS: call buildIos, collect result
    - Android: call buildAndroid, collect result
  - Move/rename artifacts to output/ with pattern: `<AppName>-<version>-<buildNumber>.<ext>`
  - Create output/ directory if missing
  - Record history entry via appendHistory with per-platform results
  - If --submit flag is set: call submit logic for successful platforms
  - Output per-platform summary: status, artifact path, duration
  - Exit 0 if all requested platforms succeeded, 1 if any failed
- [ ] Wire build command into src/index.ts (replace stub)
- [ ] Write tests with mocked fastlane runner and filesystem

Verify: `npm run build && node dist/index.js build --help` shows all flags (--platform, --profile, --submit, --skip-version-check, --json, --non-interactive); `npx vitest run -- build` passes
Commit: "feat: implement build command with expo prebuild and per-platform Fastlane builds"

---

## Task 7: Submit Command
Dependencies: Task 2, Task 4, Task 6
Creates: src/commands/submit.ts, src/platforms/ios/submit.ts, src/platforms/android/submit.ts
Requires: src/core/config.ts, src/core/history.ts, src/fastlane/runner.ts, src/utils/logger.ts

- [ ] Create `src/platforms/ios/submit.ts`:
  - `submitIos(config, { ipaPath })` — invokes `fastlane ios submit` via runner with ipa_path option
  - Returns `{ status: "success"|"error", durationSeconds: number, error?: string }`
- [ ] Create `src/platforms/android/submit.ts`:
  - `submitAndroid(config, { aabPath, serviceAccountKeyPath, track })`:
    - If serviceAccountKeyPath is not configured: return `{ status: "skipped", error: "No Google Play service account configured. Add serviceAccountKeyPath to eas.json submit.production.android or set SUPPLY_JSON_KEY env var." }`
    - Otherwise: invoke `fastlane android submit` via runner
  - Returns `{ status: "success"|"skipped"|"error", durationSeconds: number, error?: string }`
- [ ] Create `src/commands/submit.ts`:
  - Validate init has been run, exit 2 if not
  - Find latest build artifacts: check history for most recent successful build, verify artifact files exist in output/
  - If no artifacts found: exit 1 with error "No build artifacts found. Run 'rn-shipyard build' first."
  - Run platform submissions independently (try/catch each):
    - iOS: call submitIos with .ipa path
    - Android: call submitAndroid with .aab path and service account config
  - Record/update history entry with submit results
  - Output per-platform summary: status, duration, any errors
  - Exit 0 if all requested platforms succeeded/skipped, 1 if any errored
- [ ] Wire submit command into src/index.ts (replace stub)
- [ ] Write tests: successful submit, missing artifacts, Android skip when no service account

Verify: `npm run build && node dist/index.js submit --help` shows all flags; `npx vitest run -- submit` passes
Commit: "feat: implement submit command for App Store Connect and Google Play"

---

## Task 8: History Command
Dependencies: Task 2
Creates: src/commands/history.ts, tests/commands/history.test.ts
Requires: src/core/history.ts, src/core/output.ts, src/utils/logger.ts

- [ ] Create `src/commands/history.ts`:
  - Read history entries from `.shipyard/history.json` via queryHistory
  - Filter by --platform if specified (show only entries with that platform)
  - Limit results to --limit (default 10)
  - Text mode: render as cli-table3 table with columns: Date, Command, Profile, Platform, Version, Build#, Status, Duration
  - JSON mode: output filtered entries as JSON array
  - If no history entries: print "No builds yet. Run 'rn-shipyard build' to get started."
  - Color-code status: green for success, red for error, yellow for skipped
- [ ] Wire history command into src/index.ts (replace stub)
- [ ] Write tests: empty history message, populated history table output, platform filter, limit filter, JSON output

Verify: `npm run build && node dist/index.js history --json` returns valid JSON (empty array if no history); `npx vitest run -- history.test` passes
Commit: "feat: implement history command with filtering and formatted table output"

---

## Task 9: CLI Polish — Global Flags, Error UX, Integration
Dependencies: Task 3, Task 5, Task 6, Task 7, Task 8
Creates: updates to src/index.ts and all command files
Requires: all previous command implementations

- [ ] Audit all commands: ensure --json flag produces consistent `{ success: boolean, ... }` envelope in every command
- [ ] Audit all commands: ensure --non-interactive flag is respected (init reads from env/config; build warns but doesn't prompt)
- [ ] Audit exit codes: 0 success, 1 error, 2 missing config — consistent across all commands
- [ ] Add --version flag to root command (reads version from package.json)
- [ ] Ensure all ShipyardErrors in JSON mode output `{ success: false, error: { code, message, fix } }`
- [ ] Add colored symbols in text mode: green checkmarks for success, red X for failure, yellow warning triangle for warnings
- [ ] Verify Fastlane output streams in real-time during build/submit (not buffered until completion)
- [ ] Add usage examples to --help for each command (e.g., `rn-shipyard build --platform ios --profile production`)
- [ ] Handle SIGINT gracefully: clean up any running Fastlane processes on Ctrl+C
- [ ] Run full manual integration test: verify doctor → init → build → submit → history flow connects correctly (mocked)

Verify: `npm run build && node dist/index.js --version` prints version; `node dist/index.js doctor --json 2>&1 | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{JSON.parse(d);console.log('valid JSON')})"` prints "valid JSON"
Commit: "feat: polish CLI with consistent flags, error UX, and SIGINT handling"

---

## Task 10: Package + Publish Setup
Dependencies: Task 9
Creates: .npmignore, LICENSE
Requires: all previous tasks complete and passing

- [ ] Create `.npmignore` excluding: tests/, src/, tsconfig.json, tsup.config.ts, .shipyard/, templates source (include dist/, templates/ compiled, README.md, LICENSE, package.json)
- [ ] Verify `npm pack` produces clean tarball with only necessary files
- [ ] Add MIT LICENSE file
- [ ] Add `prepublishOnly` script in package.json: `npm run build && npm run test`
- [ ] Add `files` field in package.json: `["dist", "templates", "README.md", "LICENSE"]`
- [ ] Verify `npm link` works: running `rn-shipyard --help` from any directory shows all commands
- [ ] Verify `rn-shipyard doctor` runs end-to-end on the development machine
- [ ] Verify `rn-shipyard --version` displays correct version
- [ ] Add `engines` field in package.json: `{ "node": ">=18" }`
- [ ] Run final `npm run build && npx vitest run` to confirm everything passes

Verify: `npm pack --dry-run` lists expected files; `npm link && rn-shipyard --help` works; `npx vitest run` all tests pass
Commit: "chore: prepare package for npm publish"

# CLAUDE.md

## Project
rn-shipyard — A CLI tool that lets indie Expo developers build and submit iOS and Android apps locally from their Mac, replacing Expo's EAS cloud service, using Fastlane under the hood.

## Stack
- TypeScript (strict mode) + Node.js >= 22.12
- Commander.js for CLI
- tsup for bundling
- Fastlane (Ruby) for builds and submissions
- EJS for Fastlane file template generation
- vitest for testing
- chalk + ora + cli-table3 for terminal output

## Critical Rules
- All file I/O must be async/await
- Shell commands must stream output in real-time (use child_process.spawn, not exec)
- Config files are JSON (not YAML)
- No classes — use functional modules with explicit dependencies
- Tests use vitest with mocked shell layer
- Every command must support `--json` and `--non-interactive` flags
- Platform builds are isolated — one platform's failure must not prevent the other from running
- Exit codes: 0 = success, 1 = error, 2 = missing config
- JSON output envelope: always `{ success: boolean, ... }` at top level
- JSON errors: always `{ success: false, error: { code, message, fix } }`
- eas.json and app.json are READ ONLY — never modify user's config files
- Use readline for interactive prompts (no external prompt libraries)

## When Stuck
- Try 3 approaches maximum, then document the blocker with a TODO comment and move on
- If Fastlane integration fails, verify with `fastlane --version` and inspect the generated Fastfile in `fastlane/`
- If a test is flaky, mock the shell layer more aggressively
- If EJS templates produce bad output, test them in isolation with `ejs.render()` in a test file
- Check ARCHITECTURE.md for the expected file schemas if unsure about data shapes

## DO NOT
- Do NOT add features not listed in PRODUCT.md
- Do NOT change the data model without updating ARCHITECTURE.md
- Do NOT install packages not listed in ARCHITECTURE.md
- Do NOT skip writing tests
- Do NOT use placeholder data
- Do NOT add EAS Update / OTA support
- Do NOT add remote/cloud build support
- Do NOT add Windows/Linux support
- Do NOT add monorepo support
- Do NOT add custom Fastlane lane support
- Do NOT add build caching
- Do NOT add parallel platform builds (sequential only in V1)
- Do NOT add CI/CD integration features
- Do NOT auto-bump versions (warn only, never modify app.json)
- Do NOT add a GUI or TUI
- Do NOT modify user's eas.json, app.json, or app.config.js files
- Do NOT use exec() for shell commands — always use spawn() for streaming
- Do NOT add external prompt libraries (use Node.js readline)

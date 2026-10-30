# Autonomous Build Prompt — rn-shipyard

You are building rn-shipyard, a CLI tool for indie Expo developers to build and submit iOS/Android apps locally using Fastlane.

## Documents

Read these files in order before starting:
1. `PRODUCT.md` — what to build (commands, flags, user flow)
2. `ARCHITECTURE.md` — how to build it (stack, project structure, data model, Fastlane integration)
3. `TASKS.md` — in what order (10 tasks with dependencies, subtasks, verify steps)
4. `CLAUDE.md` — rules to follow (critical constraints and DO NOTs)

## Process

1. Read all four documents completely before writing any code
2. Start with Task 1 and work sequentially through Task 10
3. For each task:
   a. Read the task description, dependencies, creates, requires, and all subtasks
   b. Verify all items in "Requires" exist from previous tasks
   c. Implement all subtasks in order
   d. Run the Verify command specified in the task
   e. If verify passes, commit with the exact message specified
   f. If verify fails, fix the issue and re-verify (max 3 attempts per issue)
   g. Move to the next task
4. After all tasks: run `npm run build && npx vitest run` to confirm everything works together

## Key Constraints

- Every command must support `--json` and `--non-interactive` flags
- Platform operations are isolated: if iOS fails, Android must still proceed
- Use `child_process.spawn` for all shell commands (never `exec`) to enable streaming output
- Never modify user files (eas.json, app.json)
- All config/history is stored in `.shipyard/` directory
- Exit codes: 0 = success, 1 = error, 2 = missing config

## Blockers

- If stuck on a task after 3 attempts, add a `// TODO: [description of blocker]` comment, commit what you have, and move to the next task
- If a dependency is missing, check if a previous task should have created it
- If Fastlane commands fail in tests, mock the shell layer — don't require real Fastlane installation for tests
- Never modify PRODUCT.md, ARCHITECTURE.md, TASKS.md, or CLAUDE.md

## Quality Checks

After completing all tasks, verify:
- [ ] `rn-shipyard --help` shows all 5 commands
- [ ] `rn-shipyard --version` prints version
- [ ] `rn-shipyard doctor --json` returns valid JSON
- [ ] `rn-shipyard history --json` returns valid JSON
- [ ] `npx vitest run` — all tests pass
- [ ] `npx tsc --noEmit` — no type errors

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // .claude/worktrees holds agent copies of the repo; their tests are not ours
  test: { setupFiles: ["./tests/setup.ts"], exclude: [...configDefaults.exclude, ".claude/**", "tests/qa/**"] },
});

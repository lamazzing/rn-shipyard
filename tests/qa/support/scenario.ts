import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli, type Project, type RunResult } from "./env.js";

/** Fake values only (CONTRIBUTING: tests use obviously fake identifiers). */
export const IOS_ENV = {
  APPLE_TEAM_ID: "ABCDE12345",
  MATCH_GIT_URL: "git@example.invalid:qa/certs.git",
  MATCH_PASSWORD: "qa-fake-match-passphrase",
};

/** `init --platform ios` with the Match inputs from the environment and NO way to sign in to Apple. */
export function initIos(p: Project, mode: "--non-interactive" | "--json" = "--non-interactive", env: Record<string, string | undefined> = {}): Promise<RunResult> {
  return cli(["init", "--platform", "ios", mode, ...(mode === "--json" ? ["--non-interactive"] : [])], {
    cwd: p.dir,
    env: { ...IOS_ENV, ...env },
  });
}

/** A history.json holding one successful android build (what doctor needs to judge leftovers). */
export async function seedSuccessfulBuild(p: Project): Promise<void> {
  await mkdir(join(p.dir, "output"), { recursive: true });
  await writeFile(join(p.dir, "output", "QA-App-1.0.0-1.aab"), "x");
  await mkdir(join(p.dir, ".shipyard"), { recursive: true });
  await writeFile(
    join(p.dir, ".shipyard", "history.json"),
    JSON.stringify({
      entries: [
        {
          id: "qa000001",
          timestamp: "2026-01-01T00:00:00Z",
          command: "build",
          profile: "production",
          platforms: {
            android: { status: "success", version: "1.0.0", versionCode: 1, artifactPath: "output/QA-App-1.0.0-1.aab", durationSeconds: 1, error: null },
          },
        },
      ],
    })
  );
}

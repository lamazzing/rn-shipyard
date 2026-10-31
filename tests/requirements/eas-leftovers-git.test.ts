import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gitState } from "../../src/requirements/eas-leftovers.js";

/** Real git (no mocked shell): the app lives in a subfolder of the repository. */
const hasGit = spawnSync("git", ["--version"]).status === 0;
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf-8" });

describe.skipIf(!hasGit)("gitState with a real repository", () => {
  let root: string;
  let app: string;
  let plain: string;
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "shipyard-repo-")));
    app = join(root, "app");
    plain = await realpath(await mkdtemp(join(tmpdir(), "shipyard-norepo-")));
    git(root, "init", "-q");
    git(root, "config", "user.email", "t@example.com");
    git(root, "config", "user.name", "t");
    await mkdir(join(app, "credentials"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "app/credentials.json\napp/credentials/\n");
    await writeFile(join(app, "credentials.json"), "{}");
    await writeFile(join(app, "credentials", "a.jks"), "k");
    await writeFile(join(app, "package.json"), "{}");
    await writeFile(join(app, "other.json"), "{}");
    git(root, "add", ".gitignore", "app/package.json");
    git(root, "commit", "-q", "-m", "init");
    await mkdir(join(plain, "credentials"), { recursive: true });
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(plain, { recursive: true, force: true });
  });

  it("reads git-ignored files of an app in a subfolder as ignored", async () => {
    expect(await gitState(app, "credentials.json")).toBe("ignored");
    expect(await gitState(app, "credentials/")).toBe("ignored");
    expect(await gitState(app, "credentials/a.jks")).toBe("ignored");
  });

  it("tells tracked and not-ignored files apart", async () => {
    expect(await gitState(app, "package.json")).toBe("tracked");
    expect(await gitState(app, "other.json")).toBe("unignored");
  });

  it("answers unknown only when there is no repository", async () => {
    expect(await gitState(plain, "credentials/")).toBe("unknown");
  });
});

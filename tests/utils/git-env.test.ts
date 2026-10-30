import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nonInteractiveGitEnv, gitUrlRedirectEnv, LOW_SPEED_GIT_ARGS } from "../../src/utils/git-env.js";

describe("git-env", () => {
  it("keeps the base ssh command and appends BatchMode and a connect timeout (default 8, parameter)", () => {
    expect(nonInteractiveGitEnv("ssh -i /k").GIT_SSH_COMMAND).toBe("ssh -i /k -o BatchMode=yes -o ConnectTimeout=8");
    expect(nonInteractiveGitEnv("ssh", 15).GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes -o ConnectTimeout=15");
  });
  it("low-speed args abort a stalled https transfer", () => {
    expect(LOW_SPEED_GIT_ARGS).toEqual(["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=60"]);
  });
});

describe("gitUrlRedirectEnv", () => {
  it("one insteadOf pair when the environment has none", () => {
    expect(gitUrlRedirectEnv("/tmp/m/repo.git", "git@github.com:me/certs.git", {})).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "url./tmp/m/repo.git.insteadOf",
      GIT_CONFIG_VALUE_0: "git@github.com:me/certs.git",
    });
  });
  it("appends after GIT_CONFIG_COUNT pairs already in the environment", () => {
    const env = gitUrlRedirectEnv("/p/r.git", "https://h/r.git", { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "a", GIT_CONFIG_VALUE_0: "b" });
    expect(env).toEqual({
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_2: "url./p/r.git.insteadOf",
      GIT_CONFIG_VALUE_2: "https://h/r.git",
    });
  });
  it("ignores a garbage count", () => {
    expect(gitUrlRedirectEnv("/p", "u", { GIT_CONFIG_COUNT: "abc" }).GIT_CONFIG_COUNT).toBe("1");
  });
  it("paths with a space are kept verbatim (environment only, no shell)", () => {
    const env = gitUrlRedirectEnv("/tmp/my dir/repo.git", "u", {});
    expect(env.GIT_CONFIG_KEY_0).toBe("url./tmp/my dir/repo.git.insteadOf");
  });
});

const gitOk = spawnSync("git", ["--version"]).status === 0;
describe.skipIf(!gitOk)("gitUrlRedirectEnv with real git", () => {
  it("clones a fake ssh URL from the local bare repo with ssh disabled, all branches visible", async () => {
    const root = await mkdtemp(join(tmpdir(), "shipyard git "));
    try {
      const run = (args: string[], cwd?: string, env: Record<string, string> = {}) => {
        const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
        if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout;
      };
      run(["init", "-q", "-b", "main", join(root, "src")]);
      const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
      run([...id, "commit", "-q", "--allow-empty", "-m", "a"], join(root, "src"));
      run(["branch", "other"], join(root, "src"));
      run(["clone", "-q", "--bare", "--", join(root, "src"), join(root, "repo.git")]);

      const fake = "git@example.invalid:me/certs.git";
      const redirect = gitUrlRedirectEnv(join(root, "repo.git"), fake, {});
      const env = { ...redirect, GIT_SSH_COMMAND: "false", GIT_TERMINAL_PROMPT: "0" };
      run(["clone", "-q", "--", fake, join(root, "work")], undefined, env);
      const branches = run(["branch", "-r"], join(root, "work"));
      expect(branches).toContain("origin/main");
      expect(branches).toContain("origin/other");
      // and without the redirect the same clone fails (ssh is disabled)
      const bad = spawnSync("git", ["clone", "-q", "--", fake, join(root, "work2")], { env: { ...process.env, GIT_SSH_COMMAND: "false", GIT_TERMINAL_PROMPT: "0" } });
      expect(bad.status).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

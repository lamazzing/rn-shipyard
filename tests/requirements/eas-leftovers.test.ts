import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { runRequirementChecks } from "../../src/requirements/index.js";
import { mockMachine, makeFixture, addBuiltArtifacts, type Fixture, type Responder } from "./fixtures.js";

let fx: Fixture;
beforeEach(async () => {
  vi.mocked(exec).mockReset();
  fx = await makeFixture();
});

async function writeEas(dir: string): Promise<void> {
  await mkdir(join(dir, "credentials", "android"), { recursive: true });
  await writeFile(join(dir, "credentials", "android", "keystore.jks"), "k");
  await writeFile(
    join(dir, "credentials.json"),
    JSON.stringify({ android: { keystore: { keystorePath: "credentials/android/keystore.jks", keystorePassword: "pw", keyAlias: "a" } } })
  );
}

/** git answers: `tracked` / `ignored` / otherwise unignored */
const git = (state: "tracked" | "ignored" | "unignored" | "norepo"): Responder => (cmd, args) => {
  if (cmd !== "git") return undefined;
  if (args[0] === "ls-files") return { exitCode: state === "tracked" ? 0 : 1, stdout: "", stderr: "" };
  if (args[0] === "check-ignore") {
    return { exitCode: state === "ignored" ? 0 : state === "norepo" ? 128 : 1, stdout: "", stderr: "" };
  }
  return undefined;
};

async function leftover(f: Fixture) {
  const r = await runRequirementChecks({ projectDir: f.dir, env: f.env });
  return { r, c: r.checks.find((x) => x.id === "eas-plaintext-credentials") };
}

describe("eas-plaintext-credentials check", () => {
  it("passes when no plaintext EAS files exist", async () => {
    mockMachine();
    await addBuiltArtifacts(fx.dir);
    expect((await leftover(fx)).c?.status).toBe("pass");
  });

  it("does not warn before the first successful build (the files may be the only copy)", async () => {
    mockMachine(git("ignored"));
    await writeEas(fx.dir);
    expect((await leftover(fx)).c?.status).toBe("pass");
  });

  it("warns after a successful build, with the rm command and git-ignore state; never fails", async () => {
    mockMachine(git("ignored"));
    await writeEas(fx.dir);
    await addBuiltArtifacts(fx.dir);
    const { r, c } = await leftover(fx);
    expect(c?.status).toBe("warn");
    expect(c?.detail).toContain("credentials/ (git-ignored)");
    expect(c?.detail).toContain("credentials.json (git-ignored)");
    expect(c?.fix).toContain("rm -r -- credentials.json credentials/");
    expect(c?.fix).not.toMatch(/android\/ |ios\/ /);
    expect(r.ok).toBe(true);
    expect(await stat(join(fx.dir, "credentials.json"))).toBeTruthy(); // never deleted
  });

  it("says when the files are tracked or not ignored", async () => {
    await writeEas(fx.dir);
    await addBuiltArtifacts(fx.dir);
    mockMachine(git("tracked"));
    const tracked = (await leftover(fx)).c;
    expect(tracked?.detail).toContain("TRACKED by git");
    expect(tracked?.fix).toContain("git rm -r --cached -- credentials.json credentials/ && rm -r -- credentials.json credentials/");
    mockMachine(git("unignored"));
    expect((await leftover(fx)).c?.detail).toContain("not git-ignored");
  });

  it("an unreadable credentials.json is still reported", async () => {
    mockMachine(git("norepo"));
    await writeFile(join(fx.dir, "credentials.json"), "{ not json");
    await addBuiltArtifacts(fx.dir);
    const c = (await leftover(fx)).c;
    expect(c?.status).toBe("warn");
    expect(c?.fix).toContain("rm -- credentials.json");
  });

  it("lists loose signing files of a credentials/ folder individually", async () => {
    mockMachine(git("ignored"));
    await mkdir(join(fx.dir, "credentials"), { recursive: true });
    await writeFile(join(fx.dir, "credentials", "dist.p12"), "x");
    await writeFile(join(fx.dir, "credentials", "notes.txt"), "x");
    await addBuiltArtifacts(fx.dir);
    const c = (await leftover(fx)).c;
    expect(c?.fix).toContain("rm -- credentials/dist.p12");
    expect(c?.fix).not.toContain("notes.txt");
  });

  it("is not part of the build/submit pre-flight", async () => {
    const { runPreflight } = await import("../../src/commands/preflight.js");
    mockMachine(git("tracked"));
    await writeEas(fx.dir);
    await addBuiltArtifacts(fx.dir);
    const warn = vi.fn();
    const out = await runPreflight({
      projectDir: fx.dir,
      platforms: ["android"],
      actions: ["build-android"],
      json: true,
      nonInteractive: true,
      logger: { info() {}, success() {}, warn, error() {}, log() {}, warnings: [] },
    });
    expect(out.ok).toBe(true);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("plaintext"));
  });
});

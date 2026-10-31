import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { cli, makeProject, parseJson, readJson, runDir, type Layout, type Project } from "./support/env.js";
import { initIos, seedSuccessfulBuild } from "./support/scenario.js";

/**
 * Init in realistic setups. Matrix (pairwise: every value of every axis appears at least once):
 *
 *   layout     root | subfolder (app in app/ of the repo) | nogit
 *   mode       --non-interactive | --json
 *   state      fresh | re-init | outdated Fastfile | second platform after the first
 *
 * Each row runs the BUILT cli as a child process with real git and real fastlane files on disk.
 */
const ANDROID_ENV = { ANDROID_KEYSTORE_PASSWORD: "qa-throwaway-pass-1" };

async function sha(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function expectAndroidFiles(p: Project): void {
  expect(existsSync(join(p.dir, ".shipyard", "config.json"))).toBe(true);
  expect(existsSync(join(p.dir, ".shipyard", "android", "release.keystore"))).toBe(true);
  expect(existsSync(join(p.dir, "fastlane", "Fastfile"))).toBe(true);
  expect(existsSync(join(p.dir, "fastlane", "Appfile"))).toBe(true);
}

describe("init matrix", () => {
  const rows: Array<{ layout: Layout; mode: "--non-interactive" | "--json"; state: "fresh" | "re-init" | "outdated" | "second-platform" }> = [
    { layout: "root", mode: "--non-interactive", state: "fresh" },
    { layout: "root", mode: "--json", state: "re-init" },
    { layout: "subfolder", mode: "--non-interactive", state: "outdated" },
    { layout: "subfolder", mode: "--json", state: "fresh" },
    { layout: "nogit", mode: "--non-interactive", state: "fresh" },
    { layout: "nogit", mode: "--json", state: "second-platform" },
    { layout: "subfolder", mode: "--json", state: "second-platform" },
  ];

  for (const row of rows) {
    it(`${row.layout} / ${row.mode} / ${row.state}`, async () => {
      const p = await makeProject(row.layout, `init-${row.layout}-${row.state}`);
      const initAndroid = (mode: string) => cli(["init", "--platform", "android", mode], { cwd: p.dir, env: ANDROID_ENV });

      if (row.state === "fresh") {
        const r = await initAndroid(row.mode);
        expect(r.code, r.all).toBe(0);
        if (row.mode === "--json") expect(parseJson(r).success).toBe(true);
        expectAndroidFiles(p);
        // rn-shipyard's own ignore file keeps secrets and machine-local state out of git
        const ignore = await readFile(join(p.dir, ".shipyard", ".gitignore"), "utf8");
        expect(ignore).toMatch(/\*\.keystore/);
        expect(ignore).toMatch(/history\.json/);
        // paths in config are project-relative: the app may sit in a subfolder of the repo
        const config = await readJson(join(p.dir, ".shipyard", "config.json"));
        expect(config.platforms.android.keystorePath).toBe(".shipyard/android/release.keystore");
        expect(existsSync(join(p.repo, ".shipyard"))).toBe(p.layout !== "subfolder");
      }

      if (row.state === "re-init") {
        expect((await initAndroid("--non-interactive")).code).toBe(0);
        const ks = join(p.dir, ".shipyard", "android", "release.keystore");
        const before = await sha(ks);
        const created = (await readJson(join(p.dir, ".shipyard", "config.json"))).createdAt;
        const r = await initAndroid(row.mode);
        expect(r.code, r.all).toBe(0);
        expect(parseJson(r).success).toBe(true);
        // a second init must never replace the signing key
        expect(await sha(ks)).toBe(before);
        expect((await readJson(join(p.dir, ".shipyard", "config.json"))).createdAt).toBe(created);
      }

      if (row.state === "outdated") {
        expect((await initAndroid("--non-interactive")).code).toBe(0);
        const fastfile = join(p.dir, "fastlane", "Fastfile");
        await writeFile(fastfile, "default_platform(:android)\nplatform :android do\n  lane :build do\n  end\nend\n");
        const r = await initAndroid(row.mode);
        expect(r.code, r.all).toBe(0);
        // init regenerates a Fastfile written by an older rn-shipyard
        const text = await readFile(fastfile, "utf8");
        expect(text).toContain("task: \"bundle\"");
      }

      if (row.state === "second-platform") {
        expect((await initAndroid(row.mode)).code).toBe(0);
        const ks = join(p.dir, ".shipyard", "android", "release.keystore");
        const before = await sha(ks);
        const r = await initIos(p, row.mode);
        expect(r.code, r.all).toBe(1);
        const config = await readJson(join(p.dir, ".shipyard", "config.json"));
        expect(config.platforms.android.enabled).toBe(true);
        expect(config.platforms.ios).toMatchObject({ enabled: true, bundleId: "com.shipyardqa.app", signingMethod: "match" });
        expect(await sha(ks)).toBe(before);
        const text = await readFile(join(p.dir, "fastlane", "Fastfile"), "utf8");
        expect(text).toContain("shipyard_ios_resolve");
        expect(text).toContain("task: \"bundle\"");
        if (row.mode === "--json") {
          const j = parseJson(r);
          expect(j.setup.preserved).toContain("android");
          expect(j.setup.ios.errorCode).toBe("MATCH_AUTH_MISSING");
          expect(j.success).toBe(false);
          expect(j.error.code).toBe("MATCH_AUTH_MISSING");
        }
      }

      // and the project can always tell its own state afterwards
      const doctor = await cli(["doctor", "--json", "--non-interactive"], { cwd: p.dir });
      const d = parseJson(doctor);
      const cfg = d.checks.find((c: any) => c.id === "shipyard-config");
      expect(cfg?.status, JSON.stringify(cfg)).toBe("pass");
    });
  }
});

describe("doctor: git state of EAS leftovers", () => {
  // The check only speaks once a build has worked (until then the files may be the only copy of the keys)
  async function setup(layout: Layout, ignoreRules: string[]): Promise<Project> {
    const p = await makeProject(layout, `doctor-${layout}`);
    expect((await cli(["init", "--platform", "android", "--non-interactive"], { cwd: p.dir, env: ANDROID_ENV })).code).toBe(0);
    await writeFile(join(p.repo, ".gitignore"), ["node_modules/", ".expo/", ...ignoreRules, ""].join("\n"));
    await writeFile(join(p.dir, "credentials.json"), "{}\n");
    await mkdir(join(p.dir, "credentials"), { recursive: true });
    await writeFile(join(p.dir, "credentials", "upload.jks"), "not a real keystore");
    await seedSuccessfulBuild(p);
    return p;
  }

  async function leftovers(p: Project): Promise<string> {
    const r = await cli(["doctor", "--platform", "android", "--json", "--non-interactive"], { cwd: p.dir });
    const check = parseJson(r).checks.find((c: any) => c.id === "eas-plaintext-credentials");
    expect(check, r.stdout).toBeTruthy();
    expect(check.status).toBe("warn");
    return check.detail as string;
  }

  for (const layout of ["root", "subfolder"] as const) {
    it(`${layout}: git-ignored credentials.json and credentials/ report as ignored, never "no git info"`, async () => {
      const p = await setup(layout, ["credentials.json", "credentials/"]);
      const detail = await leftovers(p);
      expect(detail).toContain("credentials.json (git-ignored)");
      expect(detail).toContain("credentials/upload.jks (git-ignored)");
      expect(detail).not.toContain("no git info");
    });
  }

  it("root: tracked and not-ignored leftovers are told apart", async () => {
    const p = await setup("root", ["credentials.json"]);
    const add = (await import("node:child_process")).spawnSync("git", ["add", "-f", "credentials.json"], { cwd: p.repo });
    expect(add.status).toBe(0);
    const detail = await leftovers(p);
    expect(detail).toContain("credentials.json (TRACKED by git)");
    expect(detail).toContain("credentials/upload.jks (not git-ignored)");
  });

  it("nogit: no repository is the one case that says 'no git info'", async () => {
    const p = await setup("nogit", []);
    const detail = await leftovers(p);
    expect(detail).toContain("credentials.json (no git info)");
  });
});

it("the run directory exists and is outside the repository", async () => {
  expect((await stat(runDir())).isDirectory()).toBe(true);
});

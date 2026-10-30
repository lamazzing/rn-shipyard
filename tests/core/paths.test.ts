import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { toPortablePath, resolvePath, ensureShipyardGitignore } from "../../src/core/paths.js";
import { readConfig, writeConfig, type ShipyardConfig } from "../../src/core/config.js";
import { appendHistory, readHistory } from "../../src/core/history.js";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-paths-")));
});

const config = (android: Record<string, unknown>): ShipyardConfig => ({
  version: "1.0.0",
  createdAt: "x",
  outputDir: "./output",
  platforms: { android: { enabled: true, keystoreAlias: "release", ...android } as never },
});

describe("portable paths", () => {
  it("stores project paths relative and home paths as ~/", () => {
    expect(toPortablePath(dir, join(dir, "a", "b.jks"))).toBe("a/b.jks");
    expect(toPortablePath(dir, join(homedir(), ".config", "x.json"))).toBe("~/.config/x.json");
    expect(toPortablePath(dir, "/opt/elsewhere/k.jks")).toBe("/opt/elsewhere/k.jks");
    expect(toPortablePath(dir, "rel/k.jks")).toBe("rel/k.jks");
    expect(toPortablePath(dir, join(dir + "-sibling", "k"))).toBe(join(dir + "-sibling", "k"));
  });

  it("resolves ~/, relative and absolute paths", () => {
    expect(resolvePath(dir, "~/x")).toBe(join(homedir(), "x"));
    expect(resolvePath(dir, "a/b")).toBe(join(dir, "a", "b"));
    expect(resolvePath(dir, "/abs/p")).toBe("/abs/p");
  });
});

describe("config path round-trip", () => {
  it("writes relative/~ paths and reads them back absolute", async () => {
    await writeConfig(
      dir,
      config({
        keystorePath: join(dir, ".shipyard", "android", "release.keystore"),
        credentialsPath: join(homedir(), ".secrets", "c.json"),
        serviceAccountKeyPath: join(dir, "sa.json"),
      })
    );
    const raw = await readFile(join(dir, ".shipyard", "config.json"), "utf-8");
    expect(raw).not.toContain(dir);
    expect(raw).not.toContain(homedir());
    const stored = JSON.parse(raw).platforms.android;
    expect(stored.keystorePath).toBe(".shipyard/android/release.keystore");
    expect(stored.credentialsPath).toBe("~/.secrets/c.json");
    expect(stored.serviceAccountKeyPath).toBe("sa.json");

    const read = (await readConfig(dir)).platforms.android!;
    expect(read.keystorePath).toBe(join(dir, ".shipyard", "android", "release.keystore"));
    expect(read.credentialsPath).toBe(join(homedir(), ".secrets", "c.json"));
    expect(read.serviceAccountKeyPath).toBe(join(dir, "sa.json"));
  });

  it("still loads an old config with absolute paths", async () => {
    await mkdir(join(dir, ".shipyard"));
    await writeFile(
      join(dir, ".shipyard", "config.json"),
      JSON.stringify(config({ keystorePath: "/Users/old/proj/up.jks", credentialsPath: "/Users/old/c.json" }))
    );
    const read = (await readConfig(dir)).platforms.android!;
    expect(read.keystorePath).toBe("/Users/old/proj/up.jks");
    expect(read.credentialsPath).toBe("/Users/old/c.json");
  });
});

describe("history artifact paths", () => {
  it("stores absolute artifact paths in portable form", async () => {
    await appendHistory(dir, {
      command: "build",
      profile: "production",
      platforms: {
        android: {
          status: "success",
          version: "1",
          artifactPath: join(dir, "output", "a.aab"),
          durationSeconds: 1,
          error: null,
        },
        ios: { status: "error", version: "1", durationSeconds: 0, error: "x" },
      },
    });
    const raw = await readFile(join(dir, ".shipyard", "history.json"), "utf-8");
    expect(raw).not.toContain(dir);
    expect((await readHistory(dir)).entries[0].platforms.android?.artifactPath).toBe("output/a.aab");
  });
});

describe("ensureShipyardGitignore", () => {
  it("is a no-op once every entry is present", async () => {
    expect(await ensureShipyardGitignore(dir)).toBe(true);
    expect(await ensureShipyardGitignore(dir)).toBe(false);
  });
});

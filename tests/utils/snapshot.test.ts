import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotFiles, restoreFiles } from "../../src/utils/snapshot.js";
import { registerCleanup, runCleanups, clearCleanupsForTests } from "../../src/utils/cleanup.js";

describe("snapshot/restore", () => {
  it("restores modified files byte-exact, leaves new files, never creates missing ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-snap-"));
    const bin = Buffer.from([0, 255, 1, 2]);
    await writeFile(join(dir, "package.json"), "{\r\n  \"a\": 1\r\n}");
    await writeFile(join(dir, "bun.lockb"), bin);
    const snap = await snapshotFiles(dir);

    await writeFile(join(dir, "package.json"), "{}");
    await writeFile(join(dir, "bun.lockb"), "changed");
    await writeFile(join(dir, "yarn.lock"), "new");
    const report = await restoreFiles(dir, snap);

    expect((await readFile(join(dir, "package.json"))).toString()).toBe("{\r\n  \"a\": 1\r\n}");
    expect((await readFile(join(dir, "bun.lockb"))).equals(bin)).toBe(true);
    expect(report.restored.sort()).toEqual(["bun.lockb", "package.json"]);
    expect(report.created).toEqual(["yarn.lock"]);
    expect(await readFile(join(dir, "yarn.lock"), "utf-8")).toBe("new");
    await expect(readFile(join(dir, "pnpm-lock.yaml"))).rejects.toThrow();
  });

  it("recreates a file that prebuild deleted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-snap-"));
    await writeFile(join(dir, "package-lock.json"), "L");
    const snap = await snapshotFiles(dir);
    const { rm } = await import("node:fs/promises");
    await rm(join(dir, "package-lock.json"));
    await restoreFiles(dir, snap);
    expect(await readFile(join(dir, "package-lock.json"), "utf-8")).toBe("L");
  });
});

describe("cleanup registry", () => {
  beforeEach(() => clearCleanupsForTests());

  it("runs registered cleanups once and skips unregistered ones", async () => {
    let a = 0, b = 0;
    registerCleanup(async () => { a++; });
    registerCleanup(async () => { b++; }).unregister();
    await runCleanups();
    await runCleanups();
    expect([a, b]).toEqual([1, 0]);
  });
});

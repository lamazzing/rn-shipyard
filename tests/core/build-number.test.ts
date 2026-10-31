import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveIosBuildNumber, recordIosBuildNumber, getLastUsedIosBuildNumber } from "../../src/core/build-number.js";
import { recordAndroidVersionCode } from "../../src/core/version-code.js";
import { appendHistory } from "../../src/core/history.js";

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), "shipyard-bn-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

const hist = (status: "success" | "error", buildNumber: string) =>
  appendHistory(dir, {
    command: "build",
    profile: "production",
    platforms: { ios: { status, version: "1.0.0", buildNumber, durationSeconds: 1, error: null } },
  });

describe("iOS build number counter", () => {
  it("starts from app.json's integer buildNumber, or 1", async () => {
    expect(await resolveIosBuildNumber(dir, "7")).toMatchObject({ buildNumber: 7, source: "app.json", lastUsed: 0 });
    expect(await resolveIosBuildNumber(dir, undefined)).toMatchObject({ buildNumber: 1, source: "app.json" });
  });

  it("is max(app.json, lastUsed + 1) and never reuses a number", async () => {
    await recordIosBuildNumber(dir, 6);
    expect(await resolveIosBuildNumber(dir, "1")).toMatchObject({ buildNumber: 7, source: "counter", lastUsed: 6 });
    expect(await resolveIosBuildNumber(dir, "9")).toMatchObject({ buildNumber: 9, source: "app.json" });
    await recordIosBuildNumber(dir, 3); // never goes down
    expect(await getLastUsedIosBuildNumber(dir)).toBe(6);
  });

  it("takes the highest successful iOS build in history into account, ignoring failures and non-numbers", async () => {
    await hist("success", "4");
    await hist("error", "40");
    await hist("success", "1.2.3");
    expect(await getLastUsedIosBuildNumber(dir)).toBe(4);
    expect((await resolveIosBuildNumber(dir, "1")).buildNumber).toBe(5);
  });

  it("ignores a non-integer app.json buildNumber and says so", async () => {
    const r = await resolveIosBuildNumber(dir, "1.0.3");
    expect(r).toMatchObject({ buildNumber: 1, ignoredAppValue: "1.0.3" });
  });

  it("--build-number overrides but must be > lastUsed", async () => {
    await recordIosBuildNumber(dir, 5);
    expect(await resolveIosBuildNumber(dir, "1", 10)).toMatchObject({ buildNumber: 10, source: "override" });
    await expect(resolveIosBuildNumber(dir, "1", 5)).rejects.toMatchObject({ code: "BUILD_NUMBER_REUSED" });
    await expect(resolveIosBuildNumber(dir, "1", 0)).rejects.toMatchObject({ code: "INVALID_BUILD_NUMBER" });
    await expect(resolveIosBuildNumber(dir, "1", 2.5)).rejects.toMatchObject({ code: "INVALID_BUILD_NUMBER" });
  });

  it("shares version-code.json with the Android counter without clobbering it", async () => {
    await recordAndroidVersionCode(dir, 8);
    await recordIosBuildNumber(dir, 6);
    await recordAndroidVersionCode(dir, 9);
    expect(JSON.parse(await readFile(join(dir, ".shipyard", "version-code.json"), "utf-8"))).toEqual({
      android: { lastUsed: 9 },
      ios: { lastUsed: 6 },
    });
  });

  it("survives a corrupt counter file", async () => {
    await mkdir(join(dir, ".shipyard"), { recursive: true });
    await writeFile(join(dir, ".shipyard", "version-code.json"), "{nope");
    expect((await resolveIosBuildNumber(dir, undefined)).buildNumber).toBe(1);
  });
});

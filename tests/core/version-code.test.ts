import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveAndroidVersionCode,
  recordAndroidVersionCode,
  getLastUsedAndroidVersionCode,
} from "../../src/core/version-code.js";
import { appendHistory } from "../../src/core/history.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "shipyard-vc-"));
});

describe("resolveAndroidVersionCode", () => {
  it("uses app.json when nothing was used before", async () => {
    const r = await resolveAndroidVersionCode(dir, 7);
    expect(r).toMatchObject({ versionCode: 7, source: "app.json" });
  });

  it("defaults to 1 with no app.json value and no history", async () => {
    expect((await resolveAndroidVersionCode(dir, undefined)).versionCode).toBe(1);
  });

  it("takes counter + 1 when app.json is behind (app.json 1, EAS counter 3 -> 4)", async () => {
    await recordAndroidVersionCode(dir, 3);
    const r = await resolveAndroidVersionCode(dir, 1);
    expect(r).toMatchObject({ versionCode: 4, source: "counter", lastUsed: 3 });
  });

  it("takes app.json when it is ahead of the counter", async () => {
    await recordAndroidVersionCode(dir, 3);
    expect((await resolveAndroidVersionCode(dir, 10)).versionCode).toBe(10);
  });

  it("never returns a code that was already used, even when app.json equals it", async () => {
    await recordAndroidVersionCode(dir, 10);
    expect((await resolveAndroidVersionCode(dir, 10)).versionCode).toBe(11);
  });

  it("also honors successful builds in history when the counter file is missing", async () => {
    await appendHistory(dir, {
      command: "build",
      profile: "production",
      platforms: { android: { status: "success", version: "1.0.0", versionCode: 6, durationSeconds: 1, error: null } },
    });
    expect((await resolveAndroidVersionCode(dir, 1)).versionCode).toBe(7);
  });

  it("ignores failed builds in history", async () => {
    await appendHistory(dir, {
      command: "build",
      profile: "production",
      platforms: { android: { status: "error", version: "1.0.0", versionCode: 9, durationSeconds: 1, error: "x" } },
    });
    expect((await resolveAndroidVersionCode(dir, 1)).versionCode).toBe(1);
  });

  it("accepts an override above the last used code", async () => {
    await recordAndroidVersionCode(dir, 3);
    expect(await resolveAndroidVersionCode(dir, 1, 20)).toMatchObject({ versionCode: 20, source: "override" });
  });

  it("rejects an override that reuses a code", async () => {
    await recordAndroidVersionCode(dir, 5);
    await expect(resolveAndroidVersionCode(dir, 1, 5)).rejects.toMatchObject({ code: "VERSION_CODE_REUSED" });
    await expect(resolveAndroidVersionCode(dir, 1, 2)).rejects.toMatchObject({ code: "VERSION_CODE_REUSED" });
  });

  it("rejects a non-integer override", async () => {
    await expect(resolveAndroidVersionCode(dir, 1, 1.5)).rejects.toMatchObject({ code: "INVALID_VERSION_CODE" });
  });
});

describe("recordAndroidVersionCode", () => {
  it("never lowers the counter and stores only numbers", async () => {
    await recordAndroidVersionCode(dir, 8);
    await recordAndroidVersionCode(dir, 3);
    expect(await getLastUsedAndroidVersionCode(dir)).toBe(8);
    expect(JSON.parse(await readFile(join(dir, ".shipyard", "version-code.json"), "utf-8"))).toEqual({
      android: { lastUsed: 8 },
    });
  });

  it("tolerates a corrupt counter file", async () => {
    await mkdir(join(dir, ".shipyard"));
    await writeFile(join(dir, ".shipyard", "version-code.json"), "{nope");
    expect(await getLastUsedAndroidVersionCode(dir)).toBe(0);
  });
});

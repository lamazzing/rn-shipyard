import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));
vi.mock("../../src/platforms/android/build.js", () => ({ buildAndroid: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { buildAndroid } from "../../src/platforms/android/build.js";
import { writeConfig } from "../../src/core/config.js";
import { recordAndroidVersionCode } from "../../src/core/version-code.js";
import buildCmd from "../../src/commands/build.js";

const PKG = '{\n  "name": "x",\n  "scripts": { "android": "expo start --android" }\n}\n';
let dir: string;
let cwd: string;

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "shipyard-buildcmd-"));
  await writeFile(join(dir, "package.json"), PKG);
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", android: { package: "com.x.app", versionCode: 1 } } })
  );
  await writeConfig(dir, {
    version: "1.0.0",
    createdAt: "x",
    platforms: { android: { enabled: true, keystorePath: "/k.jks", keystoreAlias: "a" } },
    outputDir: "./output",
  });
  await recordAndroidVersionCode(dir, 3);
  process.chdir(dir);
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
});

const opts = { platform: "android", profile: "production", submit: false, skipVersionCheck: true, json: true, nonInteractive: true };

describe("build command", () => {
  it("restores package.json that expo prebuild rewrote, prebuilds android only, builds versionCode 4", async () => {
    vi.mocked(exec).mockImplementation((async () => {
      await writeFile(join(dir, "package.json"), PKG.replace("expo start --android", "expo run:android"));
      return { exitCode: 0, stdout: "", stderr: "" };
    }) as never);
    vi.mocked(buildAndroid).mockResolvedValue({ status: "success", artifactPath: "./output/App-1.0.0-4.aab", durationSeconds: 1 });

    await buildCmd(opts);

    expect(await readFile(join(dir, "package.json"), "utf-8")).toBe(PKG);
    const args = vi.mocked(exec).mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining(["prebuild", "--platform", "android", "--no-install"]));
    expect(vi.mocked(buildAndroid).mock.calls[0][0]).toMatchObject({ versionCode: 4, outputName: "App-1.0.0-4.aab" });
  });

  it("--version-code below the last used code aborts before prebuild", async () => {
    await buildCmd({ ...opts, versionCode: "3" }).catch(() => undefined); // process.exit is mocked
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(exec).not.toHaveBeenCalled();
    expect(buildAndroid).not.toHaveBeenCalled();
  });

  it("restores package.json when starting prebuild throws (spawn failure)", async () => {
    vi.mocked(exec).mockImplementation((async () => {
      await writeFile(join(dir, "package.json"), "partially written");
      throw new Error("spawn npx ENOENT");
    }) as never);

    await buildCmd(opts);

    expect(await readFile(join(dir, "package.json"), "utf-8")).toBe(PKG);
    expect(process.exit).toHaveBeenCalledWith(1); // PREBUILD_FAILED (exit is mocked, so the flow continues)
  });

  it("restores package.json and lockfiles on non-zero prebuild exit; leaves new lockfiles", async () => {
    const LOCK = '{"lockfileVersion":3}\n';
    const BIN = Buffer.from([0, 1, 2, 255]);
    await writeFile(join(dir, "package-lock.json"), LOCK);
    await writeFile(join(dir, "bun.lockb"), BIN);
    vi.mocked(exec).mockImplementation((async () => {
      await writeFile(join(dir, "package.json"), "{}");
      await writeFile(join(dir, "package-lock.json"), "changed");
      await writeFile(join(dir, "bun.lockb"), "changed");
      await writeFile(join(dir, "yarn.lock"), "created by prebuild");
      return { exitCode: 1, stdout: "", stderr: "bad" };
    }) as never);

    await buildCmd(opts);

    expect(await readFile(join(dir, "package.json"), "utf-8")).toBe(PKG);
    expect(await readFile(join(dir, "package-lock.json"), "utf-8")).toBe(LOCK);
    expect((await readFile(join(dir, "bun.lockb"))).equals(BIN)).toBe(true);
    expect(await readFile(join(dir, "yarn.lock"), "utf-8")).toBe("created by prebuild");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

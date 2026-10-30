import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, chmod, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Real shell layer and a real child standing in for `npx`: the point of these tests is that a
// termination signal stops the prebuild process group BEFORE package.json is restored.
vi.mock("../../src/platforms/android/build.js", () => ({ buildAndroid: vi.fn() }));

import { writeConfig } from "../../src/core/config.js";
import { recordAndroidVersionCode } from "../../src/core/version-code.js";
import { resetShutdownForTests, isShuttingDown } from "../../src/utils/shell.js";
import { handleSignal, resetSignalStateForTests } from "../../src/utils/signals.js";
import buildCmd from "../../src/commands/build.js";

const PKG = '{\n  "name": "x",\n  "scripts": { "android": "expo start --android" }\n}\n';
let dir: string;
let bin: string;
let cwd: string;
const origPath = process.env.PATH;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(path: string, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await access(path);
      return;
    } catch {
      await sleep(20);
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function installFakeNpx(opts: { ignoreSigterm?: boolean }) {
  const script = `#!/usr/bin/env node
const fs = require("fs");
const pkg = ${JSON.stringify(join(dir, "package.json"))};
const started = ${JSON.stringify(join(dir, "started"))};
const wrote = ${JSON.stringify(join(dir, "orphan-wrote"))};
${opts.ignoreSigterm ? 'process.on("SIGTERM", () => {});' : ""}
fs.writeFileSync(pkg, '{"scripts":{"android":"expo run:android"}}'); // what prebuild does first
fs.writeFileSync(started, "1");
// prebuild keeps working and rewrites package.json again later
setTimeout(() => { fs.writeFileSync(pkg, '{"orphan":true}'); fs.writeFileSync(wrote, "1"); }, 1200);
setTimeout(() => {}, 5000);
`;
  await writeFile(join(bin, "npx"), script);
  await chmod(join(bin, "npx"), 0o755);
}

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "shipyard-sig-"));
  bin = await mkdtemp(join(tmpdir(), "shipyard-sigbin-"));
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
  process.env.PATH = `${bin}:${origPath}`;
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
});

afterEach(async () => {
  await sleep(100); // let the killed child's close event pass while still "shutting down"
  resetShutdownForTests();
  resetSignalStateForTests();
  process.env.PATH = origPath;
  process.chdir(cwd);
  vi.restoreAllMocks();
});

const opts = { platform: "android", profile: "production", submit: false, skipVersionCheck: true, json: true, nonInteractive: true };

describe("termination signals during expo prebuild", () => {
  it.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
    ["SIGHUP", 129],
  ] as const)("%s: stops the prebuild child first, restores package.json after, exits %i", async (signal, code) => {
    await installFakeNpx({});
    void buildCmd(opts); // never settles once the signal handler took over
    await waitFor(join(dir, "started"));
    expect(await readFile(join(dir, "package.json"), "utf-8")).not.toBe(PKG); // prebuild modified it

    const exit = vi.fn();
    const written: string[] = [];
    await handleSignal(signal, { exit, write: (t) => void written.push(t), graceMs: 2000 });

    expect(exit).toHaveBeenCalledWith(code);
    expect(written.join("")).toContain("Interrupted. Cleaning up");
    expect(isShuttingDown()).toBe(true);
    expect(await readFile(join(dir, "package.json"), "utf-8")).toBe(PKG);

    // the orphan would have rewritten package.json at 1.2s: it must be dead
    await sleep(1500);
    expect(await readFile(join(dir, "package.json"), "utf-8")).toBe(PKG);
    await expect(access(join(dir, "orphan-wrote"))).rejects.toThrow();
    // the interrupted flow must not carry on and report a bogus result
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    await installFakeNpx({ ignoreSigterm: true });
    void buildCmd(opts);
    await waitFor(join(dir, "started"));

    const exit = vi.fn();
    await handleSignal("SIGTERM", { exit, write: () => {}, graceMs: 300 });

    expect(exit).toHaveBeenCalledWith(143);
    expect(await readFile(join(dir, "package.json"), "utf-8")).toBe(PKG);
    await sleep(1500);
    expect(await readFile(join(dir, "package.json"), "utf-8")).toBe(PKG);
    await expect(access(join(dir, "orphan-wrote"))).rejects.toThrow();
  });

  it("a second signal while cleaning up is ignored", async () => {
    const exit = vi.fn();
    const first = handleSignal("SIGINT", { exit, write: () => {}, graceMs: 100 });
    await handleSignal("SIGTERM", { exit, write: () => {}, graceMs: 100 });
    await first;
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(130);
  });
});

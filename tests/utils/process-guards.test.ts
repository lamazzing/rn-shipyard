import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { guardStream, safeWrite, isStreamDead } from "../../src/utils/terminal.js";
import { registerCleanup, runCleanups, runSyncCleanups, clearCleanupsForTests } from "../../src/utils/cleanup.js";
import { snapshotFiles, restoreFiles, restoreFilesSync } from "../../src/utils/snapshot.js";
import { handleSignal, handleCrash, resetSignalStateForTests, interruptedEnvelope } from "../../src/utils/signals.js";
import { exec, registerStdinReleaser, resetShutdownForTests, NON_INTERACTIVE_ENV } from "../../src/utils/shell.js";
import { Writable } from "node:stream";

const node = process.execPath;

beforeEach(() => {
  resetSignalStateForTests();
  clearCleanupsForTests();
  resetShutdownForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("dead stdout/stderr (EPIPE, EIO)", () => {
  it("an 'error' event on a guarded stream is swallowed and the stream is marked dead", () => {
    const s = new EventEmitter() as unknown as NodeJS.WritableStream;
    (s as unknown as { write: () => boolean }).write = () => true;
    guardStream(s);
    expect(() => (s as unknown as EventEmitter).emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).not.toThrow();
    expect(isStreamDead(s)).toBe(true);
    const write = vi.spyOn(s as unknown as { write: () => boolean }, "write");
    expect(safeWrite(s, "x")).toBe(false);
    expect(write).not.toHaveBeenCalled(); // streaming stops writing to it
  });

  it("safeWrite never throws when write throws synchronously", () => {
    const s = new Writable({ write: (_c, _e, cb) => cb() });
    vi.spyOn(s, "write").mockImplementation(() => {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    });
    expect(() => safeWrite(s, "x")).not.toThrow();
    expect(isStreamDead(s)).toBe(true);
  });

  it("a signal still restores files and exits 129 when the terminal is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-guard-"));
    await writeFile(join(dir, "package.json"), "ORIGINAL");
    const snap = await snapshotFiles(dir);
    await writeFile(join(dir, "package.json"), "MODIFIED");
    registerCleanup(async () => void (await restoreFiles(dir, snap)));
    const exit = vi.fn();
    await handleSignal("SIGHUP", {
      exit,
      write: () => {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      },
    });
    expect(exit).toHaveBeenCalledWith(129);
    expect(await readFile(join(dir, "package.json"), "utf-8")).toBe("ORIGINAL");
  });
});

describe("synchronous last-resort restore", () => {
  it("restoreFilesSync restores from the in-memory snapshot and is idempotent with the async path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-sync-"));
    await writeFile(join(dir, "package.json"), "ORIGINAL");
    const snap = await snapshotFiles(dir);
    writeFileSync(join(dir, "package.json"), "MODIFIED");
    expect(restoreFilesSync(dir, snap).restored).toEqual(["package.json"]);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe("ORIGINAL");
    expect(restoreFilesSync(dir, snap).restored).toEqual([]);
    expect((await restoreFiles(dir, snap)).restored).toEqual([]);
  });

  it("runSyncCleanups restores what the async cleanup never got to; nothing is left after runCleanups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-sync2-"));
    await writeFile(join(dir, "package.json"), "ORIGINAL");
    const snap = await snapshotFiles(dir);
    writeFileSync(join(dir, "package.json"), "MODIFIED");
    const sync = vi.fn(() => void restoreFilesSync(dir, snap));
    const hung = registerCleanup(() => new Promise<void>(() => {}), sync); // async restore that never finishes
    runSyncCleanups();
    hung.unregister();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe("ORIGINAL");

    // an entry stays registered after its async form ran (until the owner unregisters), so a
    // crash mid-restore still gets the idempotent sync form
    const sync2 = vi.fn();
    const h = registerCleanup(async () => {}, sync2);
    await runCleanups();
    runSyncCleanups();
    expect(sync2).toHaveBeenCalledTimes(1);
    h.unregister();
    runSyncCleanups();
    expect(sync2).toHaveBeenCalledTimes(1);
  });

  it("a signal restore racing the owner's own restore never runs twice, and the file ends at the snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-race-"));
    await writeFile(join(dir, "package.json"), "ORIGINAL");
    const snap = await snapshotFiles(dir);
    await writeFile(join(dir, "package.json"), "MODIFIED");
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = registerCleanup(
      async () => {
        calls++;
        await gate; // the restore is in flight when the signal handler arrives
        await restoreFiles(dir, snap);
      },
      () => void restoreFilesSync(dir, snap)
    );
    const ownerRestore = h.run();
    const exit = vi.fn();
    const handler = handleSignal("SIGINT", { exit, write: () => {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(exit).not.toHaveBeenCalled(); // the handler waits for the in-flight restore
    release();
    await Promise.all([ownerRestore, handler]);
    expect(calls).toBe(1);
    expect(exit).toHaveBeenCalledWith(130);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe("ORIGINAL");
    // exit lands while the entry is still registered: the sync fallback finds nothing to do
    writeFileSync(join(dir, "package.json"), "TRUNC");
    runSyncCleanups();
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe("ORIGINAL");
    h.unregister();
  });

  it("an uncaught exception restores then exits 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-crash-"));
    await writeFile(join(dir, "package.json"), "ORIGINAL");
    const snap = await snapshotFiles(dir);
    writeFileSync(join(dir, "package.json"), "MODIFIED");
    registerCleanup(async () => void (await restoreFiles(dir, snap)));
    const exit = vi.fn();
    const writeJson = vi.fn();
    await handleCrash(new Error("boom"), { exit, write: () => {}, json: true, writeJson });
    expect(exit).toHaveBeenCalledWith(1);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe("ORIGINAL");
    expect(JSON.parse(writeJson.mock.calls[0][0])).toMatchObject({ success: false, error: { code: "UNEXPECTED_ERROR" } });
  });
});

describe("signal exits in --json mode", () => {
  it("print an INTERRUPTED envelope, then exit with the signal code", async () => {
    const order: string[] = [];
    const writeJson = vi.fn((t: string) => void order.push("json:" + t));
    const exit = vi.fn((c: number) => void order.push("exit:" + c));
    await handleSignal("SIGTERM", { exit, write: () => {}, json: true, writeJson });
    const env = JSON.parse(writeJson.mock.calls[0][0]);
    expect(env).toEqual(JSON.parse(interruptedEnvelope("SIGTERM")));
    expect(env).toMatchObject({ success: false, error: { code: "INTERRUPTED" } });
    expect(env.error.message).toBeTruthy();
    expect(env.error.fix).toBeTruthy();
    expect(order[1]).toBe("exit:143");
  });

  it("a throwing JSON writer does not stop the exit; human mode prints no envelope", async () => {
    const exit = vi.fn();
    await handleSignal("SIGINT", {
      exit,
      write: () => {},
      json: true,
      writeJson: () => {
        throw new Error("EPIPE");
      },
    });
    expect(exit).toHaveBeenCalledWith(130);
    resetSignalStateForTests();
    const writeJson = vi.fn();
    await handleSignal("SIGINT", { exit: vi.fn(), write: () => {}, writeJson });
    expect(writeJson).not.toHaveBeenCalled();
  });

  it("does not call a monkeypatched process.exit (captured at load time)", async () => {
    const patched = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("SubmitExit");
    }) as never);
    const exit = vi.fn();
    await handleSignal("SIGTERM", { exit, write: () => {} });
    expect(exit).toHaveBeenCalledWith(143);
    expect(patched).not.toHaveBeenCalled();
  });
});

describe("exec piped mode", () => {
  it("no stdin and the fastlane-failing environment, always", async () => {
    const script = `
      const v = ["CI", "FASTLANE_IS_INTERACTIVE", "SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA"].map((k) => process.env[k]).join(",");
      let got = "";
      process.stdin.on("data", (d) => (got += d));
      process.stdin.on("end", () => console.log(v + "|stdin-eof:" + JSON.stringify(got)));
      process.stdin.resume();`;
    const r = await exec(node, ["-e", script]);
    expect(r.stdout).toBe("1,false,true|stdin-eof:\"\"");
    expect(NON_INTERACTIVE_ENV).toMatchObject({ CI: "1", FASTLANE_IS_INTERACTIVE: "false", SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA: "true" });
  });

  it("an explicit env value from the caller still wins", async () => {
    const r = await exec(node, ["-e", "console.log(process.env.CI)"], { env: { CI: "custom" } });
    expect(r.stdout).toBe("custom");
  });

  it("piped children never trigger the stdin releasers", async () => {
    const release = vi.fn();
    const un = registerStdinReleaser(release);
    await exec(node, ["-e", "0"]);
    un();
    expect(release).not.toHaveBeenCalled();
  });

  it("there is no stdin-inherit + piped-output combination any more", async () => {
    // the removed `interactive: true` option is ignored: stdin is still closed and output captured
    const r = await exec(node, ["-e", "process.stdin.on('end',()=>console.log('eof'));process.stdin.resume()"], {
      interactive: true,
    } as never);
    expect(r.stdout).toBe("eof");
  });
});

describe("prompt visibility through the redactor (2FA-style)", () => {
  it("a prompt without a trailing newline is streamed before the child finishes", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((t: string) => (out.push(String(t)), true)) as never);
    const script = `process.stdout.write("Please enter the 6 digit code: "); setTimeout(() => process.stdout.write("123456\\n"), 400);`;
    let seenEarly = "";
    const p = exec(node, ["-e", script], { stream: true, redact: ["s3cretvalue"] });
    await new Promise((r) => setTimeout(r, 250));
    seenEarly = out.join("");
    await p;
    expect(seenEarly).toBe("Please enter the 6 digit code: ");
  });

  it("an unfinished partial secret is masked, not leaked, after the idle timeout", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((t: string) => (out.push(String(t)), true)) as never);
    const script = `process.stdout.write("tok: s3cr"); setTimeout(() => process.stdout.write("x\\n"), 600);`;
    const p = exec(node, ["-e", script], { stream: true, redact: ["s3cretvalue"] });
    await new Promise((r) => setTimeout(r, 400));
    const early = out.join("");
    await p;
    expect(early).toBe("tok: ***");
    expect(out.join("")).toBe("tok: ***x\n");
  });
});

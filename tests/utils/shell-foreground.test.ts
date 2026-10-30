import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock, spawnSync: spawnSyncMock }));

import { handleSignal, resetSignalStateForTests } from "../../src/utils/signals.js";
import {
  exec,
  NON_INTERACTIVE_ENV,
  registerStdinReleaser,
  signalActiveChildrenSync,
  restoreSavedTerminalState,
  killActiveChildren,
  resetShutdownForTests,
} from "../../src/utils/shell.js";

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: null;
  stderr: null;
}
function fakeChild(pid = 4242): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.pid = pid;
  c.stdout = null;
  c.stderr = null;
  return c;
}

const setTty = (v: boolean) => {
  Object.defineProperty(process.stdin, "isTTY", { value: v, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: v, configurable: true });
};

beforeEach(() => {
  spawnMock.mockReset();
  spawnSyncMock.mockReset();
  spawnSyncMock.mockReturnValue({ status: 0, stdout: "saved:tty:state\n" });
  resetShutdownForTests();
});
afterEach(() => {
  delete (process.stdin as { isTTY?: boolean }).isTTY;
  delete (process.stdout as { isTTY?: boolean }).isTTY;
  vi.restoreAllMocks();
});

describe("exec foreground", () => {
  it("rejects without a terminal and spawns nothing", async () => {
    setTty(false);
    await expect(exec("git", ["clone"], { foreground: true })).rejects.toThrow(/needs a terminal/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("inherits all stdio, is not detached, keeps the env untouched, runs the stdin releasers first", async () => {
    setTty(true);
    const order: string[] = [];
    const un = registerStdinReleaser(() => order.push("released"));
    const child = fakeChild();
    spawnMock.mockImplementation(() => {
      order.push("spawned");
      return child;
    });
    const p = exec("git", ["clone", "x"], { foreground: true, cwd: "/tmp", env: { A: "1" } });
    child.emit("exit", 0);
    child.emit("close", 0);
    const r = await p;
    un();
    expect(order).toEqual(["released", "spawned"]);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe("git");
    expect(args).toEqual(["clone", "x"]);
    expect(opts.stdio).toBe("inherit");
    expect(opts.detached).toBeFalsy();
    expect(opts.env.A).toBe("1");
    // no fail-fast env: the user's terminal may prompt
    expect(opts.env.FASTLANE_IS_INTERACTIVE).toBe(process.env.FASTLANE_IS_INTERACTIVE);
    expect(opts.env.SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA).toBe(process.env.SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA);
    expect(r).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("is tracked as an active child: signals reach the pid itself (not a group), and a kill waits for it", async () => {
    setTty(true);
    const child = fakeChild(31337);
    spawnMock.mockReturnValue(child);
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, sig?: string | number) => {
      if (sig === 0) throw new Error("ESRCH"); // gone as soon as it was signalled
      return true;
    }) as never);
    void exec("git", ["clone"], { foreground: true });
    signalActiveChildrenSync("SIGTERM");
    expect(kill).toHaveBeenCalledWith(31337, "SIGTERM");
    child.emit("exit", null);
    await killActiveChildren(200);
    expect(kill).toHaveBeenCalledWith(31337, "SIGTERM");
  });

  it("piped children never get stdin and never run the releasers", async () => {
    const release = vi.fn();
    const un = registerStdinReleaser(release);
    const child = Object.assign(fakeChild(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    spawnMock.mockReturnValue(child);
    const p = exec("fastlane", ["ios", "build"]);
    child.emit("close", 0);
    await p;
    un();
    const opts = spawnMock.mock.calls[0][2];
    expect(opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(opts.env.CI).toBe("1");
    expect(opts.env.FASTLANE_IS_INTERACTIVE).toBe("false");
    expect(release).not.toHaveBeenCalled();
  });
});

describe("terminal state around a foreground child", () => {
  it("saves `stty -g` before spawning and restores it after the child exits", async () => {
    setTty(true);
    const order: string[] = [];
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      order.push(`stty ${args[0] === "-g" ? "save" : "restore:" + args[0]}`);
      return { status: 0, stdout: "saved:tty:state\n" };
    });
    const child = fakeChild();
    spawnMock.mockImplementation(() => (order.push("spawn"), child));
    const p = exec("fastlane", ["ios", "shipyard_apple_login"], { foreground: true });
    child.emit("close", 0);
    await p;
    expect(order).toEqual(["stty save", "spawn", "stty restore:saved:tty:state"]);
  });

  it("restores it when a signal kills the child mid-prompt (echo left off by a password read)", async () => {
    setTty(true);
    const child = fakeChild(777);
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, "kill").mockImplementation(((_pid: number, sig?: string | number) => {
      if (sig === 0) throw new Error("ESRCH");
      return true;
    }) as never);
    void exec("fastlane", ["ios", "x"], { foreground: true });
    const killing = killActiveChildren(200);
    child.emit("exit", null);
    child.emit("close", null);
    await killing;
    expect(spawnSyncMock).toHaveBeenCalledWith("stty", ["saved:tty:state"], expect.anything());
  });

  it("no stty restore when the state could not be read", async () => {
    setTty(true);
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "" });
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const p = exec("git", ["clone"], { foreground: true });
    child.emit("close", 0);
    await p;
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });
});

describe("piped children cannot prompt through git/ssh", () => {
  it("NON_INTERACTIVE_ENV disables terminal prompts, askpass programs and credential-manager dialogs", () => {
    expect(NON_INTERACTIVE_ENV).toMatchObject({
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "true",
      SSH_ASKPASS: "true",
      SSH_ASKPASS_REQUIRE: "never",
      GCM_INTERACTIVE: "never",
    });
  });
});

describe("terminal restore: timeouts and the race with signals", () => {
  const sttyRestores = () => spawnSyncMock.mock.calls.filter((c) => c[1][0] === "saved:tty:state");

  it("every stty call has a timeout (a backgrounded job would be stopped by SIGTTOU forever)", async () => {
    setTty(true);
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const p = exec("git", ["clone"], { foreground: true });
    child.emit("close", 0);
    await p;
    expect(spawnSyncMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const c of spawnSyncMock.mock.calls) expect(c[2]).toMatchObject({ timeout: 2000 });
  });

  it("restoreSavedTerminalState restores while a foreground child runs, then is a no-op; a normal exit clears it", async () => {
    setTty(true);
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const p = exec("git", ["clone"], { foreground: true });
    restoreSavedTerminalState();
    restoreSavedTerminalState();
    expect(sttyRestores()).toHaveLength(1);
    child.emit("close", 0);
    await p;
    // close restored once more (its own copy) but cleared the module state: nothing left to restore
    const before = sttyRestores().length;
    restoreSavedTerminalState();
    expect(sttyRestores()).toHaveLength(before);
  });

  it("the process-exit fallback (signalActiveChildrenSync) restores it", async () => {
    setTty(true);
    const child = fakeChild(555);
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, "kill").mockImplementation((() => true) as never);
    void exec("fastlane", ["x"], { foreground: true });
    signalActiveChildrenSync("SIGTERM");
    expect(sttyRestores()).toHaveLength(1);
  });

  it("the signal handler restores it even if the child never reports exit", async () => {
    setTty(true);
    resetSignalStateForTests();
    const child = fakeChild(556);
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, "kill").mockImplementation(((_p: number, sig?: string | number) => {
      if (sig === 0) throw new Error("ESRCH");
      return true;
    }) as never);
    void exec("fastlane", ["x"], { foreground: true });
    const exit = vi.fn();
    await handleSignal("SIGINT", { exit, write: () => {}, graceMs: 30 });
    expect(exit).toHaveBeenCalledWith(130);
    expect(sttyRestores()).toHaveLength(1);
    resetSignalStateForTests();
  });
});

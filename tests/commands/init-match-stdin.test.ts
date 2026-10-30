import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The shell layer is replaced by a registry that behaves like the real one: a child that
// inherits stdin (fastlane match) first runs every registered stdin releaser.
const releasers = new Set<() => void>();
vi.mock("../../src/utils/shell.js", () => ({
  exec: vi.fn(),
  registerStdinReleaser: (fn: () => void) => {
    releasers.add(fn);
    return () => releasers.delete(fn);
  },
}));
vi.mock("../../src/platforms/android/keystore.js", () => ({ generateKeystore: vi.fn(async () => ({ created: true })) }));
vi.mock("../../src/platforms/ios/signing.js", () => ({ setupMatch: vi.fn() }));
const events: string[] = [];
let prompterCount = 0;
vi.mock("../../src/utils/prompt.js", () => ({
  createPrompter: vi.fn(() => {
    const id = ++prompterCount;
    events.push(`open${id}`);
    return {
      ask: vi.fn(async (_q: string, d?: string) => d || "value"),
      askSecret: vi.fn(async () => "password1"),
      close: vi.fn(() => events.push(`close${id}`)),
    };
  }),
}));

import { setupMatch } from "../../src/platforms/ios/signing.js";
import initCmd from "../../src/commands/init.js";

let dir: string;
let cwd: string;

beforeEach(async () => {
  vi.clearAllMocks();
  events.length = 0;
  prompterCount = 0;
  releasers.clear();
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-matchstdin-")));
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", ios: { bundleIdentifier: "com.x.app" }, android: { package: "com.x.app" } } })
  );
  process.chdir(dir);
  process.env.MATCH_PASSWORD = "matchpw";
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  delete process.env.MATCH_PASSWORD;
  delete (process.stdin as { isTTY?: boolean }).isTTY;
  delete (process.stdout as { isTTY?: boolean }).isTTY;
});

describe("interactive init and fastlane match (stdin ownership)", () => {
  it("closes the prompter before match inherits stdin and reopens it lazily afterwards", async () => {
    vi.mocked(setupMatch).mockImplementation((async () => {
      events.push("match-start");
      for (const fn of [...releasers]) fn(); // what exec() does before spawning with inherited stdin
      events.push("match-end");
      return { success: true };
    }) as never);

    await initCmd({ platform: "all", json: false, nonInteractive: false });

    expect(vi.mocked(setupMatch).mock.calls[0][0]).toMatchObject({ interactive: true });
    const i = (e: string) => events.indexOf(e);
    expect(i("open1")).toBeLessThan(i("match-start"));
    expect(i("close1")).toBeGreaterThan(i("match-start")); // released by the exec hook...
    expect(i("close1")).toBeLessThan(i("match-end")); //      ...before the child would run
    expect(events).toContain("open2"); // the Android questions got a fresh prompter
    expect(i("open2")).toBeGreaterThan(i("match-end"));
  });

  it("--non-interactive passes interactive:false to match", async () => {
    process.env.APPLE_TEAM_ID = "TEAM";
    process.env.MATCH_GIT_URL = "git@github.com:o/r.git";
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    vi.mocked(setupMatch).mockResolvedValue({ success: true });
    try {
      await initCmd({ platform: "ios", json: false, nonInteractive: true });
    } finally {
      delete process.env.APPLE_TEAM_ID;
      delete process.env.MATCH_GIT_URL;
      delete process.env.ANDROID_KEYSTORE_PASSWORD;
    }
    expect(vi.mocked(setupMatch).mock.calls[0][0]).toMatchObject({ interactive: false });
    expect(prompterCount).toBe(0);
  });
});

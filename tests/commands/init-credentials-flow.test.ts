import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn(), registerStdinReleaser: () => () => {} }));
vi.mock("../../src/platforms/ios/signing.js", () => ({ setupMatch: vi.fn(async () => ({ success: true })) }));
vi.mock("../../src/platforms/ios/eas-import.js", () => ({
  importIosCredentials: vi.fn(async () => ({
    targets: [{ target: "app", bundleId: "com.x.app", profile: "p", certificateSha256: "AB:CD", certificateSubject: "CN=x", certificateExpires: "2027-01-01" }],
    warnings: [],
  })),
}));
const answers: Record<string, string> = {};
const asked: string[] = [];
vi.mock("../../src/utils/prompt.js", () => ({
  createPrompter: vi.fn(() => ({
    ask: vi.fn(async (q: string, d?: string) => {
      asked.push(q);
      const key = Object.keys(answers).find((k) => q.includes(k));
      return key ? answers[key] : (d ?? "");
    }),
    askSecret: vi.fn(async () => "typed-secret-1"),
    close: vi.fn(),
  })),
}));

import { exec } from "../../src/utils/shell.js";
import { setupMatch } from "../../src/platforms/ios/signing.js";
import { importIosCredentials } from "../../src/platforms/ios/eas-import.js";
import initCmd from "../../src/commands/init.js";

let dir: string;
let cwd: string;
let out: string[];
let keychainHas = false;
const ENV = ["MATCH_PASSWORD", "MATCH_GIT_URL", "APPLE_TEAM_ID", "CI"];
let saved: Record<string, string | undefined>;
const IOS_CREDS = {
  ios: { provisioningProfilePath: "credentials/ios/profile.mobileprovision", distributionCertificate: { path: "credentials/ios/dist-cert.p12", password: "p12-secret" } },
};

beforeEach(async () => {
  vi.clearAllMocks();
  for (const k of Object.keys(answers)) delete answers[k];
  asked.length = 0;
  keychainHas = false;
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-credflow-")));
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.APPLE_TEAM_ID = "ABCDE12345";
  process.env.MATCH_GIT_URL = "git@github.com:me/certs.git";
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", ios: { bundleIdentifier: "com.x.app" }, android: { package: "com.x.app" } } })
  );
  process.chdir(dir);
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new Error(`exit ${c}`);
  }) as never);
  vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) => {
    if (cmd === "security" && args[0] === "find-internet-password") return { exitCode: keychainHas ? 0 : 44, stdout: "", stderr: "" };
    if (cmd === "security" && args[0] === "add-internet-password") {
      keychainHas = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (cmd === "npx") {
      await writeFile(join(dir, "credentials.json"), JSON.stringify(IOS_CREDS)); // what eas-cli does
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "" };
  }) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  delete (process.stdin as { isTTY?: boolean }).isTTY;
  delete (process.stdout as { isTTY?: boolean }).isTTY;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("init --from-eas, interactive, credentials.json missing", () => {
  it("prints the menu path with the Apple login answer, runs eas-cli in the foreground, then imports", async () => {
    keychainHas = true;
    await initCmd({ platform: "ios", json: false, nonInteractive: false, fromEas: true });
    const text = out.join("\n");
    expect(text).toContain('Do you want to log in to your Apple account?": answer n');
    expect(text).toContain("Download credentials from EAS to credentials.json");
    const call = vi.mocked(exec).mock.calls.find(([c]) => c === "npx")!;
    expect(call[1]).toEqual(["eas-cli", "credentials", "-p", "ios"]);
    expect(call[2]).toMatchObject({ foreground: true, cwd: dir });
    expect(importIosCredentials).toHaveBeenCalledTimes(1);
  });

  it("declining leaves EAS_CREDENTIALS_NOT_FOUND (exit 2) and starts nothing", async () => {
    answers["Run `npx eas-cli credentials`"] = "n";
    await expect(initCmd({ platform: "ios", json: false, nonInteractive: false, fromEas: true })).rejects.toThrow("exit 2");
    expect(vi.mocked(exec).mock.calls.some(([c]) => c === "npx")).toBe(false);
  });

  it("platform all asks for both platforms in one go", async () => {
    keychainHas = true;
    await initCmd({ platform: "all", json: false, nonInteractive: false, fromEas: true }); // the fake file has no android section: that part is skipped with a warning
    const runs = vi.mocked(exec).mock.calls.filter(([c]) => c === "npx").map(([, a]) => a[3]);
    expect(runs).toEqual(["ios", "android"]);
  });
});

describe("init saves the Match password in the macOS keychain (interactive)", () => {
  it("asks, runs security with -w last (the password is typed into security, never in argv), then match reads the keychain", async () => {
    await initCmd({ platform: "ios", json: false, nonInteractive: false });
    const add = vi.mocked(exec).mock.calls.find(([c, a]) => c === "security" && a[0] === "add-internet-password")!;
    expect(add[1]).toEqual(["add-internet-password", "-a", "", "-s", "match_git@github.com:me/certs.git", "-U", "-w"]);
    expect(add[2]).toMatchObject({ foreground: true });
    expect(JSON.stringify(vi.mocked(exec).mock.calls)).not.toContain("typed-secret-1");
    expect(vi.mocked(setupMatch).mock.calls[0][0].password).toBeUndefined();
    const text = out.join("\n");
    expect(text).toContain("iOS: Match signing configured");
  });

  it("declining skips Match and the summary says so", async () => {
    answers["Save the Match password in the macOS keychain"] = "n";
    await initCmd({ platform: "ios", json: false, nonInteractive: false });
    expect(setupMatch).not.toHaveBeenCalled();
    const text = out.join("\n");
    expect(text).not.toContain("Match signing configured");
    expect(text).toContain("Match signing NOT set up");
    expect(text).toContain("Next steps");
  });

  it("does not ask when MATCH_PASSWORD is in the environment", async () => {
    process.env.MATCH_PASSWORD = "from-env-1";
    await initCmd({ platform: "ios", json: false, nonInteractive: false });
    expect(asked.some((q) => q.includes("keychain"))).toBe(false);
    expect(vi.mocked(setupMatch).mock.calls[0][0].password).toBe("from-env-1");
  });
});

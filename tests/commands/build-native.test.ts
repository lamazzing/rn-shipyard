import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));
vi.mock("../../src/platforms/android/build.js", () => ({ buildAndroid: vi.fn() }));
vi.mock("../../src/platforms/ios/build.js", () => ({ buildIos: vi.fn() }));
vi.mock("../../src/commands/submit.js", () => ({
  default: vi.fn(),
  runSubmit: vi.fn(),
  appleLoginPhase: vi.fn(),
  readIosAppleId: vi.fn(async () => "me@example.com"),
}));

import { exec } from "../../src/utils/shell.js";
import { buildAndroid } from "../../src/platforms/android/build.js";
import { buildIos } from "../../src/platforms/ios/build.js";
import { runSubmit, appleLoginPhase } from "../../src/commands/submit.js";
import { runPreflight } from "../../src/commands/preflight.js";
import { ShipyardError } from "../../src/utils/errors.js";
import { writeConfig } from "../../src/core/config.js";
import { recordAndroidVersionCode } from "../../src/core/version-code.js";
import buildCmd, { safeFileStem } from "../../src/commands/build.js";

const PKG = '{\n  "name": "x"\n}\n';
let dir: string;
let cwd: string;
let logged: string[];

type GitState = "not-git" | "tracked" | "ignored" | "unignored";
/** exec mock: git answers by `git`, every other command (prebuild) succeeds. */
function mockExec(git: GitState, onPrebuild?: () => Promise<void>) {
  vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) => {
    if (cmd === "git") {
      if (git === "not-git") return { exitCode: 128, stdout: "", stderr: "not a git repository" };
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true", stderr: "" };
      if (args[0] === "check-ignore") return { exitCode: git === "ignored" ? 0 : 1, stdout: "", stderr: "" };
      return { exitCode: 0, stdout: git === "tracked" ? `${args[2]}/app/build.gradle` : "", stderr: "" };
    }
    await onPrebuild?.();
    return { exitCode: 0, stdout: "", stderr: "" };
  }) as never);
}

const prebuildCalls = () => vi.mocked(exec).mock.calls.filter(([c]) => c === "npx");
const printed = () => logged.map((l) => JSON.parse(l));

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "shipyard-native-"));
  await writeFile(join(dir, "package.json"), PKG);
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", ios: { buildNumber: "5" }, android: { package: "com.x.app", versionCode: 1 } } })
  );
  await writeConfig(dir, {
    version: "1.0.0",
    createdAt: "x",
    platforms: {
      ios: { enabled: true, signingMethod: "match", matchGitUrl: "git@h:o/r.git", matchType: "appstore", teamId: "T", bundleId: "com.x.app" },
      android: { enabled: true, keystorePath: "/k.jks", keystoreAlias: "a" },
    },
    outputDir: "./output",
  });
  await recordAndroidVersionCode(dir, 3);
  process.chdir(dir);
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  logged = [];
  vi.spyOn(console, "log").mockImplementation(((m: string) => void logged.push(m)) as never);
  vi.mocked(buildAndroid).mockResolvedValue({ status: "success", artifactPath: "./output/a.aab", durationSeconds: 1 });
  vi.mocked(buildIos).mockResolvedValue({ status: "success", artifactPath: "./output/a.ipa", durationSeconds: 1 });
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
});

const opts = { platform: "all", profile: "production", submit: false, skipVersionCheck: true, json: true, nonInteractive: true };

async function gradle(versionCode: number) {
  await mkdir(join(dir, "android", "app"), { recursive: true });
  await writeFile(join(dir, "android", "app", "build.gradle"), `android {\n  defaultConfig {\n    versionCode ${versionCode}\n  }\n}\n`);
}

describe("prebuild skip rule (item 2)", () => {
  it("skips prebuild for a tracked android/, still prebuilds ios, never patches versionCode, uses the gradle value", async () => {
    await gradle(10);
    mockExec("tracked");
    await buildCmd(opts);

    const pre = prebuildCalls();
    expect(pre).toHaveLength(1);
    expect(pre[0][1]).toEqual(expect.arrayContaining(["--platform", "ios"]));
    expect(pre[0][1]).not.toContain("android");
    expect(vi.mocked(buildAndroid).mock.calls[0][0]).toMatchObject({ patchVersionCode: false, versionCode: 10 });
    expect(await readFile(join(dir, "android", "app", "build.gradle"), "utf-8")).toContain("versionCode 10");
    const out = printed()[0];
    expect(out.prebuild).toEqual({ ios: { action: "generated" }, android: { action: "skipped_tracked" } });
    expect(out.platforms.android.versionCode).toBe(10);
    expect(out.warnings.join("\n")).toContain("using versionCode 10 from android/app/build.gradle");
  });

  it("tracked android/ whose gradle versionCode was already used is an android error; ios unaffected", async () => {
    await gradle(3);
    mockExec("tracked");
    await buildCmd(opts);
    const out = printed()[0];
    expect(out.success).toBe(false);
    expect(out.platforms.android.status).toBe("error");
    expect(out.platforms.android.error).toContain("already used");
    expect(buildAndroid).not.toHaveBeenCalled();
    expect(out.platforms.ios.status).toBe("success");
  });

  it("only tracked folders: no prebuild at all", async () => {
    await gradle(10);
    await mkdir(join(dir, "ios"), { recursive: true });
    mockExec("tracked");
    await buildCmd(opts);
    expect(prebuildCalls()).toHaveLength(0);
    expect(printed()[0].prebuild).toEqual({ ios: { action: "skipped_tracked" }, android: { action: "skipped_tracked" } });
    expect(buildIos).toHaveBeenCalled();
  });

  it("--version-code with a tracked android/ is refused for android", async () => {
    await gradle(10);
    mockExec("tracked");
    await buildCmd({ ...opts, versionCode: "20" });
    expect(printed()[0].platforms.android.error).toContain("--version-code cannot be applied");
  });

  it("an untracked (gitignored, generated) folder is regenerated with --clean and patched", async () => {
    await gradle(1);
    mockExec("ignored");
    await buildCmd({ ...opts, platform: "android" });
    const pre = prebuildCalls();
    expect(pre).toHaveLength(1);
    expect(pre[0][1]).toEqual(expect.arrayContaining(["prebuild", "--clean", "--platform", "android"]));
    expect(vi.mocked(buildAndroid).mock.calls[0][0]).toMatchObject({ patchVersionCode: true, versionCode: 4 });
    expect(printed()[0].prebuild.android.action).toBe("generated");
  });

  it("an existing folder outside git is refused, never deleted; the other platform still builds", async () => {
    await mkdir(join(dir, "android"), { recursive: true });
    await writeFile(join(dir, "android", "keep.txt"), "mine");
    mockExec("not-git");
    await buildCmd(opts);

    const pre = prebuildCalls();
    expect(pre).toHaveLength(1);
    expect(pre[0][1]).toEqual(expect.arrayContaining(["--platform", "ios"])); // ios/ absent: generated
    expect(buildAndroid).not.toHaveBeenCalled();
    expect(await readFile(join(dir, "android", "keep.txt"), "utf-8")).toBe("mine");
    const out = printed()[0];
    expect(out.success).toBe(false);
    expect(out.prebuild.android).toMatchObject({
      action: "refused",
      error: { code: "NATIVE_DIR_NOT_IN_GIT", fix: expect.stringContaining("Delete android/") },
    });
    expect(out.platforms.android.status).toBe("error");
    expect(out.platforms.ios.status).toBe("success");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("a present, untracked and NOT git-ignored folder is refused, never cleaned; the other platform still builds", async () => {
    await mkdir(join(dir, "android", "app"), { recursive: true });
    await writeFile(join(dir, "android", "app", "mine.txt"), "uncommitted work");
    mockExec("unignored");
    await buildCmd(opts);

    const pre = prebuildCalls();
    expect(pre).toHaveLength(1);
    expect(pre[0][1]).toEqual(expect.arrayContaining(["--platform", "ios"]));
    expect(pre[0][1]).not.toContain("android");
    expect(buildAndroid).not.toHaveBeenCalled();
    expect(await readFile(join(dir, "android", "app", "mine.txt"), "utf-8")).toBe("uncommitted work");
    const out = printed()[0];
    expect(out.prebuild.android.action).toBe("refused");
    expect(out.prebuild.android.error.code).toBe("NATIVE_DIR_UNTRACKED");
    expect(out.prebuild.android.error.fix).toMatch(/Commit android\/.*\.gitignore.*delete/);
    expect(out.platforms.android.status).toBe("error");
    expect(out.platforms.ios.status).toBe("success");
    expect(vi.mocked(exec).mock.calls.some(([c, a]) => c === "git" && (a as string[])[0] === "check-ignore")).toBe(true);
  });

  it("absent folders need no git calls", async () => {
    mockExec("ignored");
    await buildCmd(opts);
    expect(vi.mocked(exec).mock.calls.some(([c]) => c === "git")).toBe(false);
  });
});

describe("tracked android/ with an unreadable versionCode", () => {
  it.each([
    ["a property", "    versionCode project.findProperty('vc').toInteger()"],
    ["a computed value", "    versionCode = 4 + 1"],
  ])("fails the android platform instead of warning (%s)", async (_n, line) => {
    await mkdir(join(dir, "android", "app"), { recursive: true });
    await writeFile(join(dir, "android", "app", "build.gradle"), `android {\n  defaultConfig {\n${line}\n  }\n}\n`);
    mockExec("tracked");
    await buildCmd({ ...opts, platform: "android" });
    expect(buildAndroid).not.toHaveBeenCalled();
    const out = printed()[0];
    expect(out.success).toBe(false);
    expect(out.platforms.android.status).toBe("error");
    expect(out.platforms.android.error).toMatch(/integer literal/);
    expect(out.platforms.android.error).toMatch(/versionCode = 4/);
  });

  it("builds a Kotlin DSL / Groovy assignment literal", async () => {
    await mkdir(join(dir, "android", "app"), { recursive: true });
    await writeFile(join(dir, "android", "app", "build.gradle"), "android {\n  defaultConfig {\n    versionCode = 8\n  }\n}\n");
    mockExec("tracked");
    await buildCmd({ ...opts, platform: "android" });
    expect(vi.mocked(buildAndroid).mock.calls[0][0]).toMatchObject({ patchVersionCode: false, versionCode: 8 });
  });
});

describe("interactive flag threading", () => {
  it("--non-interactive: platform builds get interactive:false; prebuild is always piped", async () => {
    mockExec("ignored");
    await buildCmd({ ...opts, json: false, nonInteractive: true });
    expect(prebuildCalls()[0][2]).not.toHaveProperty("foreground");
    expect(prebuildCalls()[0][2]).not.toHaveProperty("interactive");
    expect(vi.mocked(buildAndroid).mock.calls[0][0]).toMatchObject({ interactive: false });
    expect(vi.mocked(buildIos).mock.calls[0][0]).toMatchObject({ interactive: false });
  });

  it("a real terminal without flags is interactive for the platform builds; prebuild stays piped", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      mockExec("ignored");
      await buildCmd({ ...opts, json: false, nonInteractive: false });
      expect(prebuildCalls()[0][2]).not.toHaveProperty("foreground");
      expect(prebuildCalls()[0][2]).not.toHaveProperty("interactive");
      expect(vi.mocked(buildIos).mock.calls[0][0]).toMatchObject({ interactive: true });
    } finally {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });
});

describe("JSON output", () => {
  it("includes restore warnings that the silent logger used to drop (item 5)", async () => {
    mockExec("ignored", async () => {
      await writeFile(join(dir, "yarn.lock"), "created by prebuild");
    });
    await buildCmd({ ...opts, platform: "android" });
    const out = printed()[0];
    expect(out.warnings).toEqual([expect.stringContaining("expo prebuild created yarn.lock")]);
  });

  it("warnings is always present, empty when nothing happened", async () => {
    mockExec("ignored");
    await buildCmd({ ...opts, platform: "android" });
    expect(printed()[0].warnings).toEqual([]);
  });

  it("artifact names are file-safe", () => {
    expect(safeFileStem("../My App/x")).toBe("__My_App_x");
    expect(safeFileStem("Bob's App")).toBe("Bob_s_App");
    expect(safeFileStem("App")).toBe("App");
  });
});

describe("build --submit (item 4)", () => {
  it("passes --profile through and prints a single combined JSON document", async () => {
    mockExec("ignored");
    vi.mocked(runSubmit).mockResolvedValue({ exitCode: 0, json: { success: true, platforms: { android: { status: "success" } } } });

    await buildCmd({ ...opts, platform: "android", profile: "staging", submit: true });

    expect(vi.mocked(runSubmit).mock.calls[0][0]).toMatchObject({ profile: "staging", platform: "android", json: true });
    expect(logged).toHaveLength(1);
    const out = printed()[0];
    expect(out).toMatchObject({ success: true, submit: { success: true }, platforms: { android: { status: "success" } } });
    expect(out.warnings).toEqual([]);
    expect(process.exit).toHaveBeenLastCalledWith(0);
  });

  it("a failing submit makes the combined result fail with submit's exit code", async () => {
    mockExec("ignored");
    vi.mocked(runSubmit).mockResolvedValue({ exitCode: 2, json: { success: false, platforms: {} } });
    await buildCmd({ ...opts, platform: "android", submit: true });
    expect(printed()[0].success).toBe(false);
    expect(process.exit).toHaveBeenLastCalledWith(2);
  });

  it("does not submit when a build failed", async () => {
    mockExec("ignored");
    vi.mocked(buildAndroid).mockResolvedValue({ status: "error", error: "boom", durationSeconds: 1 });
    await buildCmd({ ...opts, platform: "android", submit: true });
    expect(runSubmit).not.toHaveBeenCalled();
    expect(logged).toHaveLength(1);
    expect(process.exit).toHaveBeenLastCalledWith(1);
  });
});

describe("secrets inside a folder prebuild would wipe", () => {
  const setKeystore = (keystorePath: string, credentialsPath?: string) =>
    writeConfig(dir, {
      version: "1.0.0",
      createdAt: "x",
      platforms: {
        ios: { enabled: true, signingMethod: "match", matchGitUrl: "git@h:o/r.git", matchType: "appstore", teamId: "T", bundleId: "com.x.app" },
        android: { enabled: true, keystorePath, keystoreAlias: "a", credentialsPath },
      },
      outputDir: "./output",
    });

  it("refuses android before prebuild when the keystore lives in a regenerated android/; ios still builds", async () => {
    await mkdir(join(dir, "android"), { recursive: true });
    await writeFile(join(dir, "android", "release.jks"), "k");
    await setKeystore(join(dir, "android", "release.jks"));
    mockExec("ignored");
    await buildCmd(opts);
    const out = printed()[0];
    expect(out.platforms.android.status).toBe("error");
    expect(out.prebuild.android.action).toBe("refused");
    expect(out.prebuild.android.error).toMatchObject({ code: "SECRET_IN_NATIVE_DIR", fix: expect.stringContaining(".shipyard/android/") });
    expect(buildAndroid).not.toHaveBeenCalled();
    // android/ is never wiped, and the prebuild that does run is ios only
    const pre = prebuildCalls();
    expect(pre).toHaveLength(1);
    expect(pre[0][1]).toEqual(expect.arrayContaining(["--platform", "ios"]));
    expect(pre[0][1]).not.toContain("android");
    expect(out.platforms.ios.status).toBe("success");
  });

  it("refuses when only the credentials file is inside the regenerated folder (and leaves that folder alone)", async () => {
    await mkdir(join(dir, "ios"), { recursive: true });
    await writeFile(join(dir, "ios", "creds.json"), "{}");
    await setKeystore("/k.jks", join(dir, "ios", "creds.json"));
    mockExec("ignored");
    await buildCmd(opts);
    const out = printed()[0];
    expect(out.platforms.android.error).toContain("ios/");
    expect(out.prebuild.android.error.code).toBe("SECRET_IN_NATIVE_DIR");
    expect(out.prebuild.ios.action).toBe("refused"); // wiping ios/ would destroy the file
    expect(prebuildCalls()).toHaveLength(0); // neither platform is regenerated
    expect(buildIos).not.toHaveBeenCalled();
    expect(await readFile(join(dir, "ios", "creds.json"), "utf-8")).toBe("{}");
  });

  it("(a) ios-only build: an android keystore inside ios/ blocks ios prebuild", async () => {
    await mkdir(join(dir, "ios"), { recursive: true });
    await writeFile(join(dir, "ios", "release.jks"), "k");
    await setKeystore(join(dir, "ios", "release.jks"));
    mockExec("ignored");
    await buildCmd({ ...opts, platform: "ios" });
    const out = printed()[0];
    expect(out.prebuild.ios.action).toBe("refused");
    expect(out.prebuild.ios.error.code).toBe("SECRET_IN_NATIVE_DIR");
    expect(out.platforms.ios.status).toBe("error");
    expect(prebuildCalls()).toHaveLength(0);
    expect(buildIos).not.toHaveBeenCalled();
    expect(await readFile(join(dir, "ios", "release.jks"), "utf-8")).toBe("k");
  });

  it("(b) android/ refused as untracked, ios/ ignored: keystore in ios/ still blocks ios prebuild", async () => {
    await mkdir(join(dir, "ios"), { recursive: true });
    await mkdir(join(dir, "android"), { recursive: true });
    await writeFile(join(dir, "ios", "release.jks"), "k");
    await setKeystore(join(dir, "ios", "release.jks"));
    vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) => {
      if (cmd === "git") {
        if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true", stderr: "" };
        if (args[0] === "check-ignore") return { exitCode: args[3] === "ios" ? 0 : 1, stdout: "", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }) as never);
    await buildCmd(opts);
    const out = printed()[0];
    expect(out.prebuild.android.error.code).toBe("NATIVE_DIR_UNTRACKED");
    expect(out.prebuild.ios.action).toBe("refused");
    expect(out.prebuild.ios.error.code).toBe("SECRET_IN_NATIVE_DIR");
    expect(prebuildCalls()).toHaveLength(0);
    expect(buildIos).not.toHaveBeenCalled();
    expect(await readFile(join(dir, "ios", "release.jks"), "utf-8")).toBe("k");
  });

  it("does not refuse when android/ is tracked (prebuild is skipped for it)", async () => {
    await gradle(10);
    await writeFile(join(dir, "android", "release.jks"), "k");
    await setKeystore(join(dir, "android", "release.jks"));
    mockExec("tracked");
    await buildCmd({ ...opts, platform: "android" });
    const out = printed()[0];
    expect(out.prebuild.android.action).toBe("skipped_tracked");
    expect(buildAndroid).toHaveBeenCalled();
  });

  it("a keystore in .shipyard/android/ is fine", async () => {
    await setKeystore(join(dir, ".shipyard", "android", "release.keystore"));
    mockExec("ignored");
    await buildCmd({ ...opts, platform: "android" });
    expect(printed()[0].prebuild.android.action).toBe("generated");
    expect(buildAndroid).toHaveBeenCalled();
  });
});

describe("requirements pre-flight and up-front prompts", () => {
  const setTty = (v: boolean) => {
    Object.defineProperty(process.stdin, "isTTY", { value: v, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: v, configurable: true });
  };
  afterEach(() => {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
    delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  it("runs the pre-flight for build-<platform> actions first; --submit adds submit-<platform>", async () => {
    mockExec("ignored");
    await buildCmd({ ...opts, platform: "ios" });
    expect(vi.mocked(runPreflight).mock.calls[0][0]).toMatchObject({ platforms: ["ios"], actions: ["build-ios"] });
    vi.mocked(runPreflight).mockClear();
    vi.mocked(runSubmit).mockResolvedValue({ exitCode: 0, json: { success: true } });
    await buildCmd({ ...opts, submit: true });
    expect(vi.mocked(runPreflight).mock.calls[0][0]).toMatchObject({
      platforms: ["ios", "android"],
      actions: ["build-ios", "submit-ios", "build-android", "submit-android"],
    });
    // the submit that follows does not repeat it
    expect(vi.mocked(runSubmit).mock.calls[0][0]).toMatchObject({ skipChecks: true });
  });

  it("a failed pre-flight exits with its code before any prebuild or build", async () => {
    vi.mocked(runPreflight).mockResolvedValueOnce({ ok: false, exitCode: 1 });
    vi.mocked(process.exit).mockImplementationOnce((() => {
      throw new Error("exit");
    }) as never);
    mockExec("ignored");
    await expect(buildCmd(opts)).rejects.toThrow("exit");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(prebuildCalls()).toHaveLength(0);
    expect(buildIos).not.toHaveBeenCalled();
  });

  it("--skip-checks bypasses the pre-flight", async () => {
    mockExec("ignored");
    await buildCmd({ ...opts, skipChecks: true });
    expect(runPreflight).not.toHaveBeenCalled();
  });

  it("build --submit in a terminal asks for the Apple login BEFORE the build starts and hands the outcome to submit", async () => {
    delete process.env.CI;
    setTty(true);
    const order: string[] = [];
    vi.mocked(appleLoginPhase).mockImplementation(async () => {
      order.push("login");
      return { status: "logged-in" };
    });
    vi.mocked(buildIos).mockImplementation(async () => {
      order.push("build");
      return { status: "success", artifactPath: "./output/a.ipa", durationSeconds: 1 };
    });
    vi.mocked(runSubmit).mockResolvedValue({ exitCode: 0 });
    mockExec("ignored");
    await buildCmd({ ...opts, json: false, nonInteractive: false, submit: true });
    expect(order).toEqual(["login", "build"]);
    expect(vi.mocked(runSubmit).mock.calls[0][0]).toMatchObject({ appleLogin: { status: "logged-in" } });
  });

  it("Ctrl-C at the Apple login question exits 130 and builds nothing", async () => {
    delete process.env.CI;
    setTty(true);
    vi.mocked(appleLoginPhase).mockRejectedValue(new ShipyardError("INTERRUPTED", "Interrupted", "Run the command again"));
    vi.mocked(process.exit).mockImplementationOnce((() => {
      throw new Error("exit");
    }) as never);
    mockExec("ignored");
    await expect(buildCmd({ ...opts, json: false, nonInteractive: false, submit: true })).rejects.toThrow("exit");
    expect(process.exit).toHaveBeenCalledWith(130);
    expect(buildIos).not.toHaveBeenCalled();
    expect(runSubmit).not.toHaveBeenCalled();
  });

  it("a failed login up front stops before the build (exit 1)", async () => {
    delete process.env.CI;
    setTty(true);
    vi.mocked(appleLoginPhase).mockResolvedValue({ status: "failed", error: "bad password" });
    vi.mocked(process.exit).mockImplementationOnce((() => {
      throw new Error("exit");
    }) as never);
    mockExec("ignored");
    await expect(buildCmd({ ...opts, json: false, nonInteractive: false, submit: true })).rejects.toThrow("exit");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(buildIos).not.toHaveBeenCalled();
  });

  it("surfaces the error code of a failed iOS build in --json (results.ios.errorCode)", async () => {
    vi.mocked(buildIos).mockResolvedValue({
      status: "error",
      durationSeconds: 1,
      error: "Could not clone the Match repository. Load your key into ssh-agent",
      errorCode: "MATCH_REPO_AUTH_FAILED",
    });
    mockExec("ignored");
    await buildCmd({ ...opts, platform: "ios" });
    expect(printed()[0].platforms.ios).toMatchObject({ status: "error", errorCode: "MATCH_REPO_AUTH_FAILED" });
  });
});

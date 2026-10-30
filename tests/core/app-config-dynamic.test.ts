import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", async (orig) => ({
  ...(await orig<typeof import("../../src/utils/shell.js")>()),
  exec: vi.fn(),
}));

import { exec } from "../../src/utils/shell.js";
import {
  parseAppConfig,
  profileEnvFrom,
  profileEnvWarnings,
  readProfileEnv,
  configFieldHint,
  type EasConfig,
} from "../../src/core/eas-parser.js";
import { checkVersion } from "../../src/core/version-check.js";
import { exitCodeForError, ShipyardError } from "../../src/utils/errors.js";
import { appendHistory } from "../../src/core/history.js";

let dir: string;
beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), "shipyard-appcfg-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const EXP = { name: "App", slug: "app", version: "1.2.3", ios: { bundleIdentifier: "com.x.app", buildNumber: "7" }, android: { package: "com.x.app", versionCode: 9 } };
const ok = (obj: unknown = EXP) => ({ exitCode: 0, stdout: JSON.stringify(obj), stderr: "" });
async function withExpo() {
  await mkdir(join(dir, "node_modules", "expo"), { recursive: true });
  await writeFile(join(dir, "node_modules", "expo", "package.json"), "{}");
}

describe("dynamic app config", () => {
  it.each(["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"])(
    "evaluates %s with `npx expo config --json`, profile env merged, no stdin, not detached",
    async (file) => {
      await withExpo();
      await writeFile(join(dir, file), "export default {}");
      vi.mocked(exec).mockResolvedValue(ok());

      const cfg = await parseAppConfig(dir, { APP_VARIANT: "production" });

      expect(cfg).toMatchObject({ source: file, name: "App", version: "1.2.3", ios: { buildNumber: "7" }, android: { versionCode: 9 } });
      const [cmd, args, opts] = vi.mocked(exec).mock.calls[0];
      expect([cmd, args]).toEqual(["npx", ["expo", "config", "--json"]]);
      expect(opts).toMatchObject({ cwd: dir, env: { APP_VARIANT: "production" }, stream: false, timeout: 60000 });
      expect(opts?.detached).toBeUndefined();
      expect(opts?.interactive).toBeUndefined();
      expect(opts?.env).not.toHaveProperty("EXPO_NO_DOTENV");
    }
  );

  it("prefers a dynamic config over app.json and accepts an { expo } wrapper and log noise", async () => {
    await withExpo();
    await writeFile(join(dir, "app.json"), JSON.stringify({ expo: { name: "Old", slug: "old", version: "0.0.1" } }));
    await writeFile(join(dir, "app.config.js"), "module.exports = {}");
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: `warn: something\n${JSON.stringify({ expo: EXP })}`, stderr: "" });
    expect((await parseAppConfig(dir)).name).toBe("App");
  });

  it("evaluation failure -> APP_CONFIG_EVAL_FAILED with the last 20 stderr lines (exit 1)", async () => {
    await withExpo();
    await writeFile(join(dir, "app.config.js"), "boom");
    const stderr = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: "", stderr });
    const err = await parseAppConfig(dir).catch((e) => e);
    expect(err).toBeInstanceOf(ShipyardError);
    expect(err.code).toBe("APP_CONFIG_EVAL_FAILED");
    expect(err.message).toContain("line 30");
    expect(err.message).toContain("line 11");
    expect(err.message).not.toContain("line 10\n");
    expect(err.fix).toContain("npx expo config --json");
    expect(err.fix).toContain("npm install");
    expect(exitCodeForError(err)).toBe(1);
  });

  it("expo not installed -> APP_CONFIG_EVAL_FAILED with fix `npm install expo`, nothing spawned", async () => {
    await writeFile(join(dir, "app.config.ts"), "export default {}");
    await expect(parseAppConfig(dir)).rejects.toMatchObject({ code: "APP_CONFIG_EVAL_FAILED", fix: "npm install expo" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("non-JSON output and spawn errors -> APP_CONFIG_EVAL_FAILED", async () => {
    await withExpo();
    await writeFile(join(dir, "app.config.js"), "x");
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 0, stdout: "hello", stderr: "" });
    await expect(parseAppConfig(dir)).rejects.toMatchObject({ code: "APP_CONFIG_EVAL_FAILED" });
    vi.mocked(exec).mockRejectedValueOnce(new Error("spawn npx ENOENT"));
    await expect(parseAppConfig(dir)).rejects.toMatchObject({ code: "APP_CONFIG_EVAL_FAILED", message: expect.stringContaining("ENOENT") });
  });

  it("missing version defaults to 1.0.0 and is flagged; name/slug stay required", async () => {
    await withExpo();
    await writeFile(join(dir, "app.config.js"), "x");
    vi.mocked(exec).mockResolvedValueOnce(ok({ name: "A", slug: "a" }));
    expect(await parseAppConfig(dir)).toMatchObject({ version: "1.0.0", versionDefaulted: true });
    vi.mocked(exec).mockResolvedValueOnce(ok({ name: "A", version: "1" }));
    await expect(parseAppConfig(dir)).rejects.toMatchObject({ code: "INVALID_APP_CONFIG" });
  });

  it("parses stdout with a leading `{x}` log line and a trailing `}` line; fails closed otherwise", async () => {
    await withExpo();
    await writeFile(join(dir, "app.config.js"), "x");
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 0, stdout: `{x} loaded plugin\n${JSON.stringify(EXP, null, 2)}`, stderr: "" });
    expect((await parseAppConfig(dir)).name).toBe("App");
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 0, stdout: `${JSON.stringify(EXP)}\n}`, stderr: "" });
    await expect(parseAppConfig(dir)).rejects.toMatchObject({ code: "APP_CONFIG_EVAL_FAILED" });
  });

  it("missing name/slug/version names the file", async () => {
    await withExpo();
    await writeFile(join(dir, "app.config.js"), "x");
    vi.mocked(exec).mockResolvedValue(ok({ version: "1" }));
    await expect(parseAppConfig(dir)).rejects.toMatchObject({ code: "INVALID_APP_CONFIG", message: expect.stringContaining("app.config.js") });
  });
});

describe("static app config errors", () => {
  it("app.json read as before, source recorded", async () => {
    await writeFile(join(dir, "app.json"), JSON.stringify({ expo: EXP }));
    expect((await parseAppConfig(dir)).source).toBe("app.json");
    expect(exec).not.toHaveBeenCalled();
  });

  it("invalid JSON -> INVALID_APP_CONFIG with the parse error, not MISSING", async () => {
    await writeFile(join(dir, "app.json"), "{ nope");
    const err = await parseAppConfig(dir).catch((e) => e);
    expect(err.code).toBe("INVALID_APP_CONFIG");
    expect(err.message).toContain("app.json");
    expect(err.message).toMatch(/JSON/);
    expect(exitCodeForError(err)).toBe(1);
  });

  it("no config file -> MISSING_CONFIG_APP (exit 2) naming all files", async () => {
    const err = await parseAppConfig(dir).catch((e) => e);
    expect(err.code).toBe("MISSING_CONFIG_APP");
    expect(err.message).toMatch(/app\.json.*app\.config\.js.*app\.config\.ts/);
    expect(exitCodeForError(err)).toBe(2);
  });
});

describe("build profile env", () => {
  const eas = (build: Record<string, unknown>) => ({ build }) as unknown as EasConfig;

  it("resolves extends chains, child overriding parent", () => {
    const cfg = eas({
      base: { env: { A: "base", B: "base", N: 1 } },
      mid: { extends: "base", env: { B: "mid" } },
      production: { extends: "mid", env: { C: "prod", A: "prod" } },
    });
    expect(profileEnvFrom(cfg, "production").env).toEqual({ A: "prod", B: "mid", C: "prod", N: "1" });
  });

  it("survives extends cycles and unknown parents", () => {
    const cfg = eas({ a: { extends: "b", env: { X: "a" } }, b: { extends: "a", env: { X: "b", Y: "b" } }, c: { extends: "ghost", env: { Z: "1" } } });
    expect(profileEnvFrom(cfg, "a").env).toEqual({ X: "a", Y: "b" });
    expect(profileEnvFrom(cfg, "c").env).toEqual({ Z: "1" });
    expect(profileEnvFrom(cfg, "nope").env).toEqual({});
  });

  it("drops variables rn-shipyard sets itself and reports them", () => {
    const cfg = eas({ production: { env: { APP_VARIANT: "p", MATCH_PASSWORD: "x", ANDROID_KEY_PASSWORD: "y", "ORG_GRADLE_PROJECT_android.injected.signing.store.password": "z" } } });
    const r = profileEnvFrom(cfg, "production");
    expect(r.env).toEqual({ APP_VARIANT: "p" });
    expect(r.ignored.sort()).toEqual(["ANDROID_KEY_PASSWORD", "MATCH_PASSWORD", "ORG_GRADLE_PROJECT_android.injected.signing.store.password"]);
  });

  it("reserves the non-interactive guard, warns on risky and non-string values", () => {
    const cfg = eas({ production: { env: { CI: "0", FASTLANE_IS_INTERACTIVE: "true", SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA: "false", PATH: "/x", DYLD_LIBRARY_PATH: "/y", NODE_OPTIONS: "--x", N: null, O: {}, A: [], OK: 1 } } });
    const r = profileEnvFrom(cfg, "production");
    expect(r.env).toEqual({ PATH: "/x", DYLD_LIBRARY_PATH: "/y", NODE_OPTIONS: "--x", OK: "1" });
    expect(r.ignored.sort()).toEqual(["CI", "FASTLANE_IS_INTERACTIVE", "SPACESHIP_ONLY_ALLOW_INTERACTIVE_2FA"]);
    expect(r.risky).toEqual(["PATH", "DYLD_LIBRARY_PATH", "NODE_OPTIONS"]);
    expect(r.invalid).toEqual(["N", "O", "A"]);
    const w = profileEnvWarnings(r, "production");
    expect(w).toHaveLength(3);
    expect(w[1]).toContain("make sure that's intended");
    expect(w[2]).toContain("N, O, A");
  });

  it("readProfileEnv reads eas.json; none -> empty", async () => {
    expect((await readProfileEnv(dir, "production")).env).toEqual({});
    await writeFile(join(dir, "eas.json"), JSON.stringify({ build: { production: { env: { APP_VARIANT: "prod" } } } }));
    expect((await readProfileEnv(dir, "production")).env).toEqual({ APP_VARIANT: "prod" });
  });
});

describe("warnings name the config file", () => {
  it("dynamic config: can't be edited, shows a snippet", () => {
    const m = configFieldHint("app.config.js", "ios.bundleIdentifier", "com.example.app");
    expect(m).toContain('"ios.bundleIdentifier" is not defined in your app.config.js');
    expect(m).toContain("can't update this file programmatically");
    expect(m).toContain('ios: { bundleIdentifier: "com.example.app" }');
  });

  it("app.json: JSON snippet", () => {
    const m = configFieldHint("app.json", "android.package", "com.example.app");
    expect(m).toContain('{"expo":{"android":{"package":"com.example.app"}}}');
    expect(m).toContain("app.json");
  });

  it("version check warning names app.config.js", async () => {
    await withExpo();
    await writeFile(join(dir, "app.config.js"), "x");
    vi.mocked(exec).mockResolvedValue(ok());
    await appendHistory(dir, {
      command: "build",
      profile: "production",
      platforms: { ios: { status: "success", version: "1.2.3", buildNumber: "7", durationSeconds: 1, error: null } },
    });
    const r = await checkVersion(dir);
    expect(r.shouldWarn).toBe(true);
    expect(r.message).toContain("app.config.js");
    expect(r.message).toContain("can't");
  });
});

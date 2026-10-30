import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", async (orig) => ({
  ...(await orig<typeof import("../../src/utils/shell.js")>()),
  exec: vi.fn(),
}));
vi.mock("../../src/fastlane/runner.js", () => ({ runFastlane: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { runFastlane } from "../../src/fastlane/runner.js";
import { generateKeystore } from "../../src/platforms/android/keystore.js";
import { buildAndroid } from "../../src/platforms/android/build.js";
import { generateFastfile } from "../../src/fastlane/generator.js";
import { recordAndroidVersionCode, resolveAndroidVersionCode } from "../../src/core/version-code.js";

const STORE = "st0re-S3cret!";
const KEY = "k3y-S3cret$";
let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), "shipyard-secrets-"));
});

describe("no secret in any spawned argv", () => {
  it("keytool gets passwords via -storepass:env/-keypass:env, never in argv", async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    await generateKeystore({ outputPath: join(dir, "ks", "r.jks"), alias: "a", password: STORE, keyPassword: KEY });

    const [cmd, args, opts] = vi.mocked(exec).mock.calls[0];
    expect(cmd).toBe("keytool");
    expect(args.join("\n")).not.toContain(STORE);
    expect(args.join("\n")).not.toContain(KEY);
    expect(args).not.toContain("-storepass");
    expect(args).toContain("-storepass:env");
    expect(args).toContain("-keypass:env");
    const envNames = args.filter((_, i) => ["-storepass:env", "-keypass:env"].includes(args[i - 1]));
    expect(envNames.map((n) => opts?.env?.[n])).toEqual([STORE, KEY]);
  });

  it("fastlane args and Gradle get passwords by env only", async () => {
    await mkdir(join(dir, "android", "app"), { recursive: true });
    await writeFile(join(dir, "android", "app", "build.gradle"), "versionCode 1\n");
    await writeFile(join(dir, "k.jks"), "x");
    await writeFile(join(dir, "c.json"), JSON.stringify({ keystorePassword: STORE, keyPassword: KEY, keyAlias: "a" }));
    vi.mocked(runFastlane).mockResolvedValue({ success: false, exitCode: 1, output: "x", durationSeconds: 1 });
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: "SHIPYARD_PROBE.DOTTED.NAME=probe-ok", stderr: "" });

    await buildAndroid({
      config: { enabled: true, keystorePath: join(dir, "k.jks"), keystoreAlias: "a", credentialsPath: join(dir, "c.json") },
      outputDir: "./output", outputName: "a.aab", projectDir: dir, versionCode: 2, json: true,
    });

    const [, , options, execOpts] = vi.mocked(runFastlane).mock.calls[0];
    expect(JSON.stringify(options)).not.toContain(STORE);
    expect(JSON.stringify(options)).not.toContain(KEY);
    expect(execOpts?.env?.["ORG_GRADLE_PROJECT_android.injected.signing.store.password"]).toBe(STORE);
    expect(execOpts?.env?.["ORG_GRADLE_PROJECT_android.injected.signing.key.password"]).toBe(KEY);
    expect(execOpts?.redact).toEqual([STORE, KEY]);
  });

  it("generated Fastfile has no password -P properties", async () => {
    await generateFastfile(dir, {
      version: "1.0.0", createdAt: "x", outputDir: "./output",
      platforms: { android: { enabled: true, keystorePath: "k.jks", keystoreAlias: "a" } },
    }, "App");
    const fastfile = await readFile(join(dir, "fastlane", "Fastfile"), "utf-8");
    expect(fastfile).not.toMatch(/signing\.(store|key)\.password/);
    expect(fastfile).not.toMatch(/PASSWORD/);
    expect(fastfile).toContain("android.injected.signing.key.alias");
  });
});

describe("version-code counter after a failed fastlane run", () => {
  async function setup() {
    await mkdir(join(dir, "android", "app"), { recursive: true });
    await writeFile(join(dir, "android", "app", "build.gradle"), "versionCode 1\n");
    await writeFile(join(dir, "k.jks"), "x");
    await writeFile(join(dir, "c.json"), JSON.stringify({ keystorePassword: STORE }));
    return { enabled: true, keystorePath: join(dir, "k.jks"), keystoreAlias: "a", credentialsPath: join(dir, "c.json") };
  }

  it("does not advance or persist the counter when fastlane fails", async () => {
    const config = await setup();
    await recordAndroidVersionCode(dir, 3);
    const before = await readFile(join(dir, ".shipyard", "version-code.json"), "utf-8");
    vi.mocked(runFastlane).mockResolvedValue({ success: false, exitCode: 1, output: "BUILD FAILED", durationSeconds: 1 });

    const r = await buildAndroid({ config, outputDir: "./output", outputName: "a.aab", projectDir: dir, versionCode: 4, json: true });

    expect(r.status).toBe("error");
    expect(await readFile(join(dir, ".shipyard", "version-code.json"), "utf-8")).toBe(before);
    expect((await resolveAndroidVersionCode(dir, 1)).versionCode).toBe(4);
  });

  it("does not create the counter file at all on a first failed build", async () => {
    const config = await setup();
    vi.mocked(runFastlane).mockResolvedValue({ success: false, exitCode: 1, output: "BUILD FAILED", durationSeconds: 1 });
    await buildAndroid({ config, outputDir: "./output", outputName: "a.aab", projectDir: dir, versionCode: 1, json: true });
    await expect(readFile(join(dir, ".shipyard", "version-code.json"), "utf-8")).rejects.toThrow();
  });

  it("does not advance the counter when fastlane throws", async () => {
    const config = await setup();
    vi.mocked(runFastlane).mockRejectedValue(new Error("boom"));
    await buildAndroid({ config, outputDir: "./output", outputName: "a.aab", projectDir: dir, versionCode: 1, json: true }).catch(() => undefined);
    await expect(readFile(join(dir, ".shipyard", "version-code.json"), "utf-8")).rejects.toThrow();
  });
});

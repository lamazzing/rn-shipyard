import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { loadAndroidCredentials, resolvePath } from "../../src/platforms/android/credentials.js";
import { setGradleVersionCode, copyReleaseAab } from "../../src/platforms/android/gradle.js";
import { redactSecrets } from "../../src/utils/shell.js";

let dir: string;
const savedEnv = { ...process.env };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "shipyard-android-"));
  delete process.env.ANDROID_KEYSTORE_PASSWORD;
  delete process.env.ANDROID_KEY_PASSWORD;
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("resolvePath", () => {
  it("handles absolute, ~ and project-relative paths", () => {
    expect(resolvePath("/p", "/abs/x.jks")).toBe("/abs/x.jks");
    expect(resolvePath("/p", "~/x.jks")).toBe(join(homedir(), "x.jks"));
    expect(resolvePath("/p", "./rel/x.jks")).toBe("/p/rel/x.jks");
  });
});

describe("loadAndroidCredentials", () => {
  async function files(creds: object) {
    await writeFile(join(dir, "k.jks"), "x");
    await writeFile(join(dir, "c.json"), JSON.stringify(creds));
    return { enabled: true, keystorePath: join(dir, "k.jks"), keystoreAlias: "cfg", credentialsPath: join(dir, "c.json") };
  }

  it("reads passwords and alias from the credentials file (absolute keystore path)", async () => {
    const config = await files({ keystorePassword: "s", keyAlias: "a", keyPassword: "k" });
    expect(await loadAndroidCredentials(dir, config)).toEqual({
      keystorePath: join(dir, "k.jks"), keyAlias: "a", keystorePassword: "s", keyPassword: "k",
    });
  });

  it("env overrides the file; key password falls back to the store password", async () => {
    const config = await files({ keystorePassword: "s", keyAlias: "a" });
    process.env.ANDROID_KEYSTORE_PASSWORD = "from-env";
    const c = await loadAndroidCredentials(dir, config);
    expect(c.keystorePassword).toBe("from-env");
    expect(c.keyPassword).toBe("from-env");
  });

  it("fails clearly when the keystore is missing", async () => {
    await expect(
      loadAndroidCredentials(dir, { enabled: true, keystorePath: join(dir, "none.jks"), keystoreAlias: "a" })
    ).rejects.toMatchObject({ code: "KEYSTORE_NOT_FOUND" });
  });

  it("fails clearly without any password", async () => {
    await writeFile(join(dir, "k.jks"), "x");
    await expect(
      loadAndroidCredentials(dir, { enabled: true, keystorePath: join(dir, "k.jks"), keystoreAlias: "a" })
    ).rejects.toMatchObject({ code: "MISSING_CONFIG_ANDROID" });
  });
});

describe("setGradleVersionCode", () => {
  it("rewrites only the versionCode line", async () => {
    await mkdir(join(dir, "android", "app"), { recursive: true });
    const p = join(dir, "android", "app", "build.gradle");
    await writeFile(p, "defaultConfig {\n        applicationId 'x'\n        versionCode 1\n        versionName \"1.0.0\"\n}\n");
    await setGradleVersionCode(dir, 42);
    expect(await readFile(p, "utf-8")).toBe("defaultConfig {\n        applicationId 'x'\n        versionCode 42\n        versionName \"1.0.0\"\n}\n");
  });

  it("throws instead of silently shipping the wrong code", async () => {
    await mkdir(join(dir, "android", "app"), { recursive: true });
    await writeFile(join(dir, "android", "app", "build.gradle"), "android {}\n");
    await expect(setGradleVersionCode(dir, 4)).rejects.toMatchObject({ code: "VERSION_CODE_PATCH_FAILED" });
  });
});

describe("copyReleaseAab", () => {
  it("throws AAB_NOT_FOUND when Gradle produced nothing", async () => {
    await expect(copyReleaseAab(dir, join(dir, "out", "a.aab"))).rejects.toMatchObject({ code: "AAB_NOT_FOUND" });
  });
});

describe("redactSecrets", () => {
  it("masks secrets and ignores empty values", () => {
    expect(redactSecrets("-Pstore.password=hunter22 x", ["hunter22", ""])).toBe("-Pstore.password=*** x");
  });
});

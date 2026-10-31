import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { androidSdk, androidSkipReason, cli, makeKeystore, makeNativeProject, parseJson, readJson, run } from "./support/env.js";

/**
 * The whole Android path with real tools and no account: a throwaway keystore made by keytool,
 * `init --non-interactive`, a real `expo prebuild` + Gradle `bundleRelease` through fastlane, then
 * the .aab is checked with jarsigner and the history file.
 */
const skip = androidSkipReason();
if (skip) console.warn(`[qa] Android build scenario skipped: ${skip}`);

describe.skipIf(!!skip)("android (keytool keystore -> init -> build -> signed .aab)", () => {
  it(
    "builds a signed .aab and records it",
    async () => {
      const p = await makeNativeProject("android-build");
      const ks = await makeKeystore(join(p.dir, "..", "android-build-secrets"));
      const env = { ANDROID_HOME: androidSdk(), ANDROID_SDK_ROOT: androidSdk() };

      const init = await cli(
        ["init", "--platform", "android", "--non-interactive", "--json", "--android-keystore", ks.keystore, "--android-credentials", ks.credentials],
        { cwd: p.dir, env }
      );
      expect(init.code, init.all).toBe(0);
      expect(parseJson(init).success).toBe(true);

      const build = await cli(["build", "--platform", "android", "--non-interactive", "--json"], {
        cwd: p.dir,
        env: { ...env, ANDROID_KEYSTORE_PASSWORD: ks.password },
        timeoutMs: 40 * 60_000,
      });
      expect(build.code, build.all.slice(-4000)).toBe(0);
      const out = parseJson(build);
      expect(out.success).toBe(true);
      const android = out.platforms.android;
      expect(android.status).toBe("success");
      const aab = join(p.dir, android.artifactPath);
      expect(android.artifactPath).toMatch(/\.aab$/);
      expect(existsSync(aab), aab).toBe(true);

      // signed with the throwaway upload key, not unsigned or debug-signed
      const verify = await run("jarsigner", ["-verify", "-verbose", "-certs", "-keystore", ks.keystore, "-storepass", ks.password, aab], { cwd: p.dir });
      expect(verify.code, verify.all).toBe(0);
      expect(verify.all).toContain("jar verified");
      expect(verify.all).toContain("CN=QA Throwaway");

      // history records the build, with a project-relative artifact path
      const history = await readJson(join(p.dir, ".shipyard", "history.json"));
      const entry = history.entries.at(-1);
      expect(entry.command).toBe("build");
      expect(entry.platforms.android).toMatchObject({ status: "success", versionCode: 1 });
      expect(entry.platforms.android.artifactPath).toBe(android.artifactPath);
      expect(entry.platforms.android.artifactPath.startsWith("/")).toBe(false);

      // versionCode counter advanced, and a second history call sees the entry
      expect((await readJson(join(p.dir, ".shipyard", "version-code.json"))).android.lastUsed).toBe(1);
      const hist = parseJson(await cli(["history", "--json"], { cwd: p.dir }));
      expect(hist.entries.length).toBeGreaterThanOrEqual(1);
    },
    45 * 60_000
  );
});

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readEasCredentials } from "../../src/core/eas-credentials.js";
import { importAndroidKeystore } from "../../src/platforms/android/eas-import.js";

// Real keytool, no mocks. Skipped where no JDK is installed.
const hasKeytool = spawnSync("keytool", ["-help"], { stdio: "ignore" }).error === undefined;
const STORE_PW = "Real-store-pw-1";

describe.skipIf(!hasKeytool)("EAS keystore import with a real keytool", () => {
  let work: string;
  let home: string;
  let savedHome: string | undefined;

  beforeAll(async () => {
    work = await realpath(await mkdtemp(join(tmpdir(), "shipyard-eas-real-")));
    home = await realpath(await mkdtemp(join(tmpdir(), "shipyard-eas-home-")));
    await mkdir(join(work, "credentials", "android"), { recursive: true });
    const gen = spawnSync(
      "keytool",
      ["-genkeypair", "-keystore", join(work, "credentials/android/keystore.jks"), "-alias", "upload-key", "-keyalg", "RSA", "-keysize", "2048",
       "-validity", "100", "-storepass:env", "KS_PW", "-keypass:env", "KS_PW", "-dname", "CN=Throwaway,O=Test,C=US"],
      { env: { ...process.env, KS_PW: STORE_PW }, encoding: "utf-8" }
    );
    expect(gen.status, gen.stderr + gen.stdout).toBe(0);
    await writeFile(
      join(work, "credentials.json"),
      JSON.stringify({ android: { keystore: { keystorePath: "credentials/android/keystore.jks", keystorePassword: STORE_PW, keyAlias: "upload-key", keyPassword: STORE_PW } } })
    );
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  it("copies a keystore that opens with the stored passwords, and reports the real fingerprint", async () => {
    savedHome = process.env.HOME;
    process.env.HOME = home;
    const eas = await readEasCredentials(work);
    const r = await importAndroidKeystore({ creds: eas.android!, slug: "real-app" });

    const stored = JSON.parse(await readFile(r.credentialsPath, "utf-8"));
    const list = spawnSync("keytool", ["-list", "-v", "-keystore", r.keystorePath, "-alias", stored.keyAlias, "-storepass:env", "SP"], {
      env: { ...process.env, SP: stored.keystorePassword },
      encoding: "utf-8",
    });
    expect(list.status, list.stderr + list.stdout).toBe(0);
    expect(list.stdout).toContain(r.sha256);
    expect(r.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    // a wrong password is rejected before anything is copied
    const bad = await importAndroidKeystore({ creds: { ...eas.android!, keystorePassword: "wrong-password" }, slug: "real-app-2" }).catch((e) => e);
    expect(bad.code).toBe("EAS_KEYSTORE_INVALID");
  });
});

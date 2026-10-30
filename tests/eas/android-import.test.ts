import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, stat, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));
import { exec } from "../../src/utils/shell.js";
import { importAndroidKeystore, secretsDirFor } from "../../src/platforms/android/eas-import.js";

const FP = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, "0").toUpperCase()).join(":");
const STORE_PW = "store-PW-1!";
const KEY_PW = "key-PW-2!";
const creds = (dir: string) => ({ keystorePath: join(dir, "src.jks"), keystorePassword: STORE_PW, keyAlias: "upload", keyPassword: KEY_PW });

let home: string;
let work: string;
let savedHome: string | undefined;

type Behaviour = { list?: { exitCode: number; out: string }; certreq?: number };
function mockKeytool(b: Behaviour = {}) {
  vi.mocked(exec).mockImplementation((async (_cmd: string, args: string[]) => {
    if (args.includes("-list")) {
      const l = b.list ?? { exitCode: 0, out: `Alias name: upload\nCertificate fingerprints:\n\t SHA1: AA\n\t SHA256: ${FP}\n` };
      return { exitCode: l.exitCode, stdout: l.out, stderr: "" };
    }
    if (args.includes("-certreq")) return { exitCode: b.certreq ?? 0, stdout: "", stderr: "" };
    throw new Error("unexpected " + args.join(" "));
  }) as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  home = await realpath(await mkdtemp(join(tmpdir(), "shipyard-eashome-")));
  work = await realpath(await mkdtemp(join(tmpdir(), "shipyard-easwork-")));
  savedHome = process.env.HOME;
  process.env.HOME = home;
  await writeFile(join(work, "src.jks"), "keystore-bytes-A");
  mockKeytool();
});
afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

describe("importAndroidKeystore", () => {
  it("copies the keystore (dir 0700, files 0600), writes rn-shipyard's credentials file and returns the SHA-256", async () => {
    const r = await importAndroidKeystore({ creds: creds(work), slug: "My App" });
    expect(r.dir).toBe(join(home, ".config", "rn-shipyard", "my-app"));
    expect(secretsDirFor("My App")).toBe(r.dir);
    expect(r.sha256).toBe(FP);
    expect((await stat(r.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(r.keystorePath)).mode & 0o777).toBe(0o600);
    expect((await stat(r.credentialsPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(r.keystorePath, "utf-8")).toBe("keystore-bytes-A");
    expect(JSON.parse(await readFile(r.credentialsPath, "utf-8"))).toEqual({ keystorePassword: STORE_PW, keyAlias: "upload", keyPassword: KEY_PW });
  });

  it("passes passwords to keytool through the environment only, never argv", async () => {
    await importAndroidKeystore({ creds: creds(work), slug: "app" });
    const calls = vi.mocked(exec).mock.calls;
    expect(calls.length).toBe(2); // -list and -certreq
    for (const [cmd, args, o] of calls) {
      expect(cmd).toBe("keytool");
      expect(args.join(" ")).not.toContain(STORE_PW);
      expect(args.join(" ")).not.toContain(KEY_PW);
      expect(args).toContain("-storepass:env");
      expect(o!.env).toMatchObject({ SHIPYARD_EAS_STOREPASS: STORE_PW, SHIPYARD_EAS_KEYPASS: KEY_PW });
      expect(o!.redact).toEqual(expect.arrayContaining([STORE_PW, KEY_PW]));
    }
  });

  it("alias that is not in the keystore: EAS_KEYSTORE_INVALID, nothing copied", async () => {
    mockKeytool({ list: { exitCode: 1, out: "keytool error: java.lang.Exception: Alias <upload> does not exist" } });
    const err = await importAndroidKeystore({ creds: creds(work), slug: "app" }).catch((e) => e);
    expect(err.code).toBe("EAS_KEYSTORE_INVALID");
    expect(err.message).toContain('"upload" does not exist');
    await expect(readdir(join(home, ".config"))).rejects.toThrow();
  });

  it("wrong keystore password: EAS_KEYSTORE_INVALID without the password in the message", async () => {
    mockKeytool({ list: { exitCode: 1, out: `keytool error: Keystore was tampered with, or password was incorrect ${STORE_PW}` } });
    const err = await importAndroidKeystore({ creds: creds(work), slug: "app" }).catch((e) => e);
    expect(err.code).toBe("EAS_KEYSTORE_INVALID");
  });

  it("wrong key password (certreq fails): EAS_KEYSTORE_INVALID", async () => {
    mockKeytool({ certreq: 1 });
    const err = await importAndroidKeystore({ creds: creds(work), slug: "app" }).catch((e) => e);
    expect(err.code).toBe("EAS_KEYSTORE_INVALID");
    expect(err.message).toContain("key password");
  });

  it("missing keystore file: EAS_KEYSTORE_INVALID", async () => {
    const err = await importAndroidKeystore({ creds: { ...creds(work), keystorePath: join(work, "gone.jks") }, slug: "app" }).catch((e) => e);
    expect(err.code).toBe("EAS_KEYSTORE_INVALID");
  });

  it("is idempotent for the same keystore", async () => {
    await importAndroidKeystore({ creds: creds(work), slug: "app" });
    const again = await importAndroidKeystore({ creds: creds(work), slug: "app" });
    expect(again.unchanged).toBe(true);
    expect(again.backupPath).toBeUndefined();
  });

  describe("a different keystore already in the target", () => {
    beforeEach(async () => {
      const dir = secretsDirFor("app");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "release.keystore"), "OTHER-KEYSTORE");
      await writeFile(join(dir, "android-credentials.json"), "OLD-CREDS");
    });

    it("non-interactive: EAS_KEYSTORE_EXISTS and the file is untouched", async () => {
      const err = await importAndroidKeystore({ creds: creds(work), slug: "app" }).catch((e) => e);
      expect(err.code).toBe("EAS_KEYSTORE_EXISTS");
      expect(await readFile(join(secretsDirFor("app"), "release.keystore"), "utf-8")).toBe("OTHER-KEYSTORE");
    });

    it("interactive, answer no: EAS_KEYSTORE_EXISTS", async () => {
      const confirmReplace = vi.fn(async () => false);
      const err = await importAndroidKeystore({ creds: creds(work), slug: "app", confirmReplace }).catch((e) => e);
      expect(err.code).toBe("EAS_KEYSTORE_EXISTS");
      expect(confirmReplace).toHaveBeenCalledOnce();
    });

    it("interactive, answer yes: the old keystore is kept as a .bak file, never deleted", async () => {
      const r = await importAndroidKeystore({ creds: creds(work), slug: "app", confirmReplace: async () => true });
      expect(r.backupPath).toBeDefined();
      expect(await readFile(r.backupPath!, "utf-8")).toBe("OTHER-KEYSTORE");
      // the old passwords are kept with the old keystore (same suffix), the new file holds the new ones
      expect(r.credentialsBackupPath).toBe(r.credentialsPath + r.backupPath!.slice(r.keystorePath.length));
      expect(await readFile(r.credentialsBackupPath!, "utf-8")).toBe("OLD-CREDS");
      expect(JSON.parse(await readFile(r.credentialsPath, "utf-8")).keystorePassword).toBe(STORE_PW);
      expect(await readFile(r.keystorePath, "utf-8")).toBe("keystore-bytes-A");
    });
  });
});

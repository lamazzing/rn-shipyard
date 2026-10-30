import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, realpath, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/platforms/android/keystore.js", () => ({ generateKeystore: vi.fn() }));
vi.mock("../../src/platforms/ios/signing.js", () => ({ setupMatch: vi.fn() }));
vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { generateKeystore } from "../../src/platforms/android/keystore.js";
import initCmd, { type InitOptions } from "../../src/commands/init.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

let dir: string;
let cwd: string;
let out: string[];
let savedPw: string | undefined;

async function run(extra: Partial<InitOptions>): Promise<{ code: number; json: any }> {
  let code = 0;
  try {
    await initCmd({ platform: "android", json: true, nonInteractive: true, ...extra });
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
    code = e.code;
  }
  return { code, json: out.length ? JSON.parse(out.join("\n")) : undefined };
}

const exists = (p: string) => access(p).then(() => true, () => false);

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-initflags-")));
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", android: { package: "com.x.app" } } })
  );
  await writeFile(join(dir, "up.jks"), "x");
  process.chdir(dir);
  out = [];
  savedPw = process.env.ANDROID_KEYSTORE_PASSWORD;
  delete process.env.ANDROID_KEYSTORE_PASSWORD;
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  if (savedPw === undefined) delete process.env.ANDROID_KEYSTORE_PASSWORD;
  else process.env.ANDROID_KEYSTORE_PASSWORD = savedPw;
});

describe("init credentials validation", () => {
  it("fails when the credentials file has no keystore password", async () => {
    await writeFile(join(dir, "c.json"), JSON.stringify({ keyAlias: "a" }));
    const { code, json } = await run({ androidKeystore: join(dir, "up.jks"), androidCredentials: join(dir, "c.json") });
    expect(code).toBe(2);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("MISSING_CONFIG_ANDROID");
    expect(json.error.message).toContain("keystorePassword");
    expect(json.error.fix).toBeTruthy();
    expect(await exists(join(dir, ".shipyard", "config.json"))).toBe(false);
  });

  it("fails when the credentials file has no key alias", async () => {
    await writeFile(join(dir, "c.json"), JSON.stringify({ keystorePassword: "p" }));
    const { code, json } = await run({ androidKeystore: join(dir, "up.jks"), androidCredentials: join(dir, "c.json") });
    expect(code).toBe(2);
    expect(json.error.message).toContain("keyAlias");
  });

  it("accepts ANDROID_KEYSTORE_PASSWORD in place of the file's password", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "from-env";
    await writeFile(join(dir, "c.json"), JSON.stringify({ keyAlias: "a" }));
    const { code } = await run({ androidKeystore: join(dir, "up.jks"), androidCredentials: join(dir, "c.json") });
    expect(code).toBe(0);
  });
});

describe("init flag combinations", () => {
  it("--android-credentials without --android-keystore is an explicit error", async () => {
    await writeFile(join(dir, "c.json"), JSON.stringify({ keystorePassword: "p", keyAlias: "a" }));
    const { code, json } = await run({ androidCredentials: join(dir, "c.json") });
    expect(code).toBe(1);
    expect(json.error.code).toBe("INVALID_FLAGS");
    expect(json.error.fix).toContain("--android-keystore");
    expect(generateKeystore).not.toHaveBeenCalled();
    expect(await exists(join(dir, ".shipyard", "config.json"))).toBe(false);
  });

  it("uses the keystorePath named by the credentials file (relative to that file)", async () => {
    await mkdir(join(dir, "secrets"));
    await writeFile(join(dir, "secrets", "c.json"), JSON.stringify({ keystorePath: "../up.jks", keystorePassword: "p", keyAlias: "a" }));
    const { code } = await run({ androidCredentials: join(dir, "secrets", "c.json") });
    expect(code).toBe(0);
    const config = JSON.parse(await readFile(join(dir, ".shipyard", "config.json"), "utf-8"));
    expect(config.platforms.android.keystorePath).toBe("up.jks");
    expect(config.platforms.android.credentialsPath).toBe("secrets/c.json");
  });

  it("Android flags with --platform ios are an explicit error", async () => {
    const { code, json } = await run({ platform: "ios", androidKeystore: join(dir, "up.jks") });
    expect(code).toBe(1);
    expect(json.error.code).toBe("INVALID_FLAGS");
    expect(json.error.message).toContain("--android-keystore");
  });

  it("rejects a bad --android-last-version-code before doing anything", async () => {
    const { code, json } = await run({ androidKeystore: join(dir, "up.jks"), androidLastVersionCode: "abc" });
    expect(code).toBe(1);
    expect(json.error.code).toBe("INVALID_FLAGS");
    expect(await exists(join(dir, ".shipyard"))).toBe(false);
  });
});

describe("init .shipyard/.gitignore", () => {
  it("creates it with the machine-local entries", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    vi.mocked(generateKeystore).mockResolvedValue({ created: true } as never);
    const { code } = await run({});
    expect(code).toBe(0);
    const gi = await readFile(join(dir, ".shipyard", ".gitignore"), "utf-8");
    for (const e of ["history.json", "*.keystore", "*.jks", "*.log"]) expect(gi).toContain(e);
  });

  it("keeps user edits and appends only missing entries", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    vi.mocked(generateKeystore).mockResolvedValue({ created: true } as never);
    await mkdir(join(dir, ".shipyard"));
    await writeFile(join(dir, ".shipyard", ".gitignore"), "# mine\nhistory.json\ncustom.txt\n");
    await run({});
    const gi = await readFile(join(dir, ".shipyard", ".gitignore"), "utf-8");
    expect(gi.startsWith("# mine\nhistory.json\ncustom.txt\n")).toBe(true);
    expect(gi.match(/^history\.json$/gm)).toHaveLength(1);
    expect(gi).toContain("*.jks");
  });
});

describe("init refuses secrets inside a folder prebuild wipes", () => {
  it("--android-keystore inside android/", async () => {
    await mkdir(join(dir, "android"));
    await writeFile(join(dir, "android", "up.jks"), "x");
    const { code, json } = await run({ androidKeystore: join(dir, "android", "up.jks") });
    expect(code).toBe(1);
    expect(json.error.code).toBe("SECRET_IN_NATIVE_DIR");
    expect(json.error.fix).toBe("move it to .shipyard/android/ or outside the project");
    expect(await exists(join(dir, ".shipyard", "config.json"))).toBe(false);
  });

  it("--android-credentials inside ios/ (relative path too)", async () => {
    await mkdir(join(dir, "ios"));
    await writeFile(join(dir, "ios", "c.json"), JSON.stringify({ keystorePassword: "p", keyAlias: "a" }));
    const { code, json } = await run({ androidKeystore: "up.jks", androidCredentials: "ios/c.json" });
    expect(code).toBe(1);
    expect(json.error.code).toBe("SECRET_IN_NATIVE_DIR");
    expect(json.error.message).toContain("ios/");
  });

  it("keystorePath named by the credentials file", async () => {
    await mkdir(join(dir, "android"));
    await writeFile(join(dir, "android", "k.jks"), "x");
    await writeFile(join(dir, "c.json"), JSON.stringify({ keystorePath: "android/k.jks", keystorePassword: "p", keyAlias: "a" }));
    const { code, json } = await run({ androidCredentials: join(dir, "c.json") });
    expect(code).toBe(1);
    expect(json.error.code).toBe("SECRET_IN_NATIVE_DIR");
  });

  it("a look-alike folder (android-keys/) is fine", async () => {
    await mkdir(join(dir, "android-keys"));
    await writeFile(join(dir, "android-keys", "k.jks"), "x");
    const { code } = await run({ androidKeystore: join(dir, "android-keys", "k.jks") });
    expect(code).toBe(0);
  });
});

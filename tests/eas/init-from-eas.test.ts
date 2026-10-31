import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, realpath, access, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/platforms/ios/signing.js", () => ({ setupMatch: vi.fn() }));
vi.mock("../../src/platforms/ios/eas-import.js", () => ({
  importIosCredentials: vi.fn(async () => ({
    targets: [{ target: "app", bundleId: "com.x.app", profile: "p", certificateSha256: "AB:CD", certificateSubject: "CN=x", certificateExpires: "2027-01-01" }],
    warnings: [],
  })),
}));
vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn(), registerStdinReleaser: () => () => {} }));

import { exec } from "../../src/utils/shell.js";
import { setupMatch } from "../../src/platforms/ios/signing.js";
import { importIosCredentials } from "../../src/platforms/ios/eas-import.js";
import initCmd, { type InitOptions } from "../../src/commands/init.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

const STORE_PW = "Store-PW-9!";
const KEY_PW = "Key-PW-8!";
const FP = Array.from({ length: 32 }, (_, i) => (i * 5 + 1).toString(16).padStart(2, "0").toUpperCase()).join(":");

let dir: string;
let home: string;
let cwd: string;
let out: string[];
let saved: Record<string, string | undefined>;
let keytoolListExit = 0;

async function run(extra: Partial<InitOptions> = {}): Promise<{ code: number; json: any; text: string }> {
  let code = 0;
  try {
    await initCmd({ platform: "android", json: true, nonInteractive: true, fromEas: true, ...extra });
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
    code = e.code;
  }
  const text = out.join("\n");
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { code, json, text };
}
const exists = (p: string) => access(p).then(() => true, () => false);
const easJson = (extra: object = {}) =>
  writeFile(
    join(dir, "credentials.json"),
    JSON.stringify({ android: { keystore: { keystorePath: "credentials/android/keystore.jks", keystorePassword: STORE_PW, keyAlias: "upload", keyPassword: KEY_PW } }, ...extra })
  );

beforeEach(async () => {
  vi.clearAllMocks();
  keytoolListExit = 0;
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-initeas-")));
  home = await realpath(await mkdtemp(join(tmpdir(), "shipyard-initeas-home-")));
  saved = Object.fromEntries(["HOME", "MATCH_PASSWORD", "MATCH_GIT_URL", "APPLE_TEAM_ID", "ANDROID_KEYSTORE_PASSWORD"].map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  for (const k of ["MATCH_PASSWORD", "MATCH_GIT_URL", "APPLE_TEAM_ID", "ANDROID_KEYSTORE_PASSWORD"]) delete process.env[k];
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "My App", slug: "my-app", version: "1.0.0", ios: { bundleIdentifier: "com.x.app" }, android: { package: "com.x.app" } } })
  );
  await mkdir(join(dir, "credentials", "android"), { recursive: true });
  await writeFile(join(dir, "credentials/android/keystore.jks"), "EAS-KEYSTORE");
  await easJson();
  process.chdir(dir);
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);
  vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) => {
    if (cmd === "keytool") {
      if (args.includes("-list")) {
        return keytoolListExit === 0
          ? { exitCode: 0, stdout: `SHA256: ${FP}\n`, stderr: "" }
          : { exitCode: 1, stdout: "keytool error: java.lang.Exception: Alias <upload> does not exist", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (cmd === "git") return { exitCode: 1, stdout: "", stderr: "" }; // not ignored, not tracked
    if (cmd === "security") return { exitCode: 44, stdout: "", stderr: "" }; // no Match passphrase in the keychain
    return { exitCode: 0, stdout: "", stderr: "" };
  }) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("init --from-eas (Android)", () => {
  it("imports the keystore, configures ~/-portable paths, prints the fingerprint, never a password", async () => {
    const { code, json, text } = await run();
    expect(code).toBe(0);
    const target = join(home, ".config", "rn-shipyard", "my-app");
    expect(await readFile(join(target, "release.keystore"), "utf-8")).toBe("EAS-KEYSTORE");
    expect((await stat(target)).mode & 0o777).toBe(0o700);
    expect((await stat(join(target, "release.keystore"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(target, "android-credentials.json"))).mode & 0o777).toBe(0o600);

    const config = JSON.parse(await readFile(join(dir, ".shipyard", "config.json"), "utf-8"));
    expect(config.platforms.android).toMatchObject({
      keystorePath: "~/.config/rn-shipyard/my-app/release.keystore",
      keystoreAlias: "upload",
      credentialsPath: "~/.config/rn-shipyard/my-app/android-credentials.json",
    });
    expect(config.platforms.ios).toBeUndefined();

    expect(json.success).toBe(true);
    expect(json.imported.android).toMatchObject({ keyAlias: "upload", sha256: FP, keystore: "~/.config/rn-shipyard/my-app/release.keystore" });
    expect(json.imported.source).toBe("credentials.json");
    expect(json.plaintextFiles).toEqual(["credentials.json", "credentials/"]);
    expect(json.nextSteps.join("\n")).toContain("rm -r -- credentials.json credentials/");
    expect(json.nextSteps.join("\n")).toContain("Upload key certificate");
    for (const secret of [STORE_PW, KEY_PW]) {
      expect(text).not.toContain(secret);
      expect(await readFile(join(dir, ".shipyard", "config.json"), "utf-8")).not.toContain(secret);
    }
    expect(await readFile(join(dir, ".gitignore"), "utf-8")).toContain("credentials/");
    // the EAS files stay where they are
    expect(await exists(join(dir, "credentials.json"))).toBe(true);
    expect(await exists(join(dir, "credentials/android/keystore.jks"))).toBe(true);
  });

  it("human output shows the fingerprint and the delete command, not the passwords", async () => {
    const { code, text } = await run({ json: false });
    expect(code).toBe(0);
    expect(text).toContain(FP);
    expect(text).toContain("rm -r -- credentials.json credentials/");
    expect(text).toContain("contain your signing passwords");
    expect(text).not.toContain(STORE_PW);
    expect(text).not.toContain(KEY_PW);
  });

  it("warns (does not fail) when the EAS files are not git-ignored", async () => {
    const { code, json } = await run();
    expect(code).toBe(0);
    expect(json.warnings.join("\n")).toContain("credentials.json holds your signing passwords/keys and was not git-ignored");
  });

  it("warns with the exact command when the EAS files are tracked by git", async () => {
    vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "ls-files") return { exitCode: 0, stdout: "", stderr: "" };
      if (cmd === "git") return { exitCode: 1, stdout: "", stderr: "" };
      if (cmd === "keytool") return { exitCode: 0, stdout: `SHA256: ${FP}\n`, stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    }) as never);
    const { json } = await run();
    expect(json.warnings.join("\n")).toContain("tracked by git. Untrack it: git rm --cached -- credentials.json");
  });

  it("missing credentials.json: EAS_CREDENTIALS_NOT_FOUND, exit 2, with the eas-cli steps", async () => {
    const { code, json } = await run({ fromEas: "nope/credentials.json" });
    expect(code).toBe(2);
    expect(json).toMatchObject({ success: false, error: { code: "EAS_CREDENTIALS_NOT_FOUND" } });
    expect(json.error.fix).toContain("Download credentials from EAS to credentials.json");
    expect(await exists(join(dir, ".shipyard"))).toBe(false);
  });

  it("invalid credentials.json: EAS_CREDENTIALS_INVALID, exit 1, no side effects", async () => {
    await writeFile(join(dir, "credentials.json"), "{ not json");
    const { code, json } = await run();
    expect(code).toBe(1);
    expect(json.error.code).toBe("EAS_CREDENTIALS_INVALID");
    expect(await exists(join(home, ".config"))).toBe(false);
  });

  it("alias mismatch: exit 1, nothing copied, no config written", async () => {
    keytoolListExit = 1;
    const { code, json } = await run();
    expect(code).toBe(1);
    expect(json.error.code).toBe("EAS_KEYSTORE_INVALID");
    expect(await exists(join(home, ".config"))).toBe(false);
    expect(await exists(join(dir, ".shipyard", "config.json"))).toBe(false);
  });

  it("a different keystore already in ~/.config/rn-shipyard/<slug>: non-interactive refuses and leaves it alone", async () => {
    const target = join(home, ".config", "rn-shipyard", "my-app");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "release.keystore"), "OLD");
    const { code, json } = await run();
    expect(code).toBe(1);
    expect(json.error.code).toBe("EAS_KEYSTORE_EXISTS");
    expect(await readFile(join(target, "release.keystore"), "utf-8")).toBe("OLD");
  });

  it("Expo-docs layout (android/keystores, ios/certs): individual files, never android/ or ios/ in .gitignore, warnings or rm", async () => {
    await mkdir(join(dir, "android", "keystores"), { recursive: true });
    await writeFile(join(dir, "android/keystores/release.keystore"), "EAS-KEYSTORE");
    await writeFile(join(dir, "credentials.json"), JSON.stringify({ android: { keystore: { keystorePath: "android/keystores/release.keystore", keystorePassword: STORE_PW, keyAlias: "upload" } } }));
    vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "ls-files") return { exitCode: 0, stdout: "", stderr: "" }; // tracked
      if (cmd === "git") return { exitCode: 1, stdout: "", stderr: "" };
      if (cmd === "keytool") return { exitCode: 0, stdout: `SHA256: ${FP}\n`, stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    }) as never);
    const { code, json } = await run();
    expect(code).toBe(0);
    expect(json.plaintextFiles).toEqual(["credentials.json", "android/keystores/release.keystore"]);
    const gi = (await readFile(join(dir, ".gitignore"), "utf-8")).split("\n");
    expect(gi).toContain("android/keystores/release.keystore");
    expect(gi).not.toContain("android/");
    expect(gi).not.toContain("ios/");
    const everything = JSON.stringify(json.warnings) + json.nextSteps.join("\n");
    expect(everything).not.toMatch(/(^|[ '"])(android|ios)\/(?!keystores)/);
    expect(everything).toContain("rm -- credentials.json android/keystores/release.keystore");
    expect(everything).not.toContain("rm -r");
    expect(everything).toContain("git rm --cached -- android/keystores/release.keystore");
    // git is asked with literal pathspecs
    const gitCalls = vi.mocked(exec).mock.calls.filter((c) => c[0] === "git");
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const c of gitCalls) expect((c[2] as any).env).toMatchObject({ GIT_LITERAL_PATHSPECS: "1" });
  });

  it("files outside the project are in the delete step (as ~/ path) but not in .gitignore", async () => {
    const ks = join(home, "secrets", "my key.jks");
    await mkdir(join(home, "secrets"), { recursive: true });
    await writeFile(ks, "EAS-KEYSTORE");
    await writeFile(join(dir, "credentials.json"), JSON.stringify({ android: { keystore: { keystorePath: ks, keystorePassword: STORE_PW, keyAlias: "upload" } } }));
    const { code, json } = await run();
    expect(code).toBe(0);
    expect(json.plaintextFiles).toEqual(["credentials.json", "~/secrets/my key.jks"]);
    expect(json.nextSteps.join("\n")).toContain("rm -- credentials.json ~/'secrets/my key.jks'");
    expect(await readFile(join(dir, ".gitignore"), "utf-8")).not.toContain("secrets");
    expect(json.warnings.join("\n")).toContain("outside the project");
  });


  it("--from-eas cannot be combined with --android-keystore", async () => {
    const { code, json } = await run({ androidKeystore: join(dir, "x.jks") });
    expect(code).toBe(1);
    expect(json.error.code).toBe("INVALID_FLAGS");
  });

  it("--platform all with only an android section: iOS is skipped with a warning, no new key is generated", async () => {
    const { code, json } = await run({ platform: "all" });
    expect(code).toBe(0);
    expect(json.warnings.join("\n")).toContain("has no ios section");
    expect(JSON.parse(await readFile(join(dir, ".shipyard", "config.json"), "utf-8")).platforms.ios).toBeUndefined();
    expect(importIosCredentials).not.toHaveBeenCalled();
  });

  it("--platform ios when the file has no ios section: EAS_CREDENTIALS_INVALID", async () => {
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(1);
    expect(json.error.code).toBe("EAS_CREDENTIALS_INVALID");
    expect(json.error.message).toContain("no ios section");
  });
});

describe("init --from-eas (iOS)", () => {
  const iosSection = {
    ios: { provisioningProfilePath: "credentials/ios/profile.mobileprovision", distributionCertificate: { path: "credentials/ios/dist-cert.p12", password: "p12-secret" } },
  };
  beforeEach(async () => {
    await writeFile(join(dir, "credentials.json"), JSON.stringify(iosSection));
    process.env.MATCH_GIT_URL = "git@github.com:me/certs.git";
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    process.env.MATCH_PASSWORD = "match-pw";
  });

  it("hands the targets to the importer instead of running 'fastlane match', and reports what was imported", async () => {
    const { code, json, text } = await run({ platform: "ios" });
    expect(code).toBe(0);
    expect(setupMatch).not.toHaveBeenCalled();
    const arg = vi.mocked(importIosCredentials).mock.calls[0][0];
    expect(arg).toMatchObject({
      gitUrl: "git@github.com:me/certs.git",
      teamId: "ABCDE12345",
      bundleId: "com.x.app",
      matchPassword: "match-pw",
      interactive: false,
      projectDir: dir,
    });
    expect(arg.targets[0]).toMatchObject({ name: "app", certificatePassword: "p12-secret" });
    expect(arg.targets[0].certificatePath).toBe(join(dir, "credentials/ios/dist-cert.p12"));
    expect(json.imported.ios.targets[0]).toMatchObject({ target: "app", bundleId: "com.x.app", certificateSha256: "AB:CD" });
    expect(json.nextSteps.join("\n")).toContain("rn-shipyard build --platform ios");
    for (const secret of ["p12-secret", "match-pw"]) expect(text).not.toContain(secret);
    // the lane the importer needs is in the generated Fastfile
    expect(await readFile(join(dir, "fastlane", "Fastfile"), "utf-8")).toContain("lane :shipyard_match_import");
  });

  it("non-interactive without MATCH_PASSWORD: MISSING_CONFIG_IOS, exit 2", async () => {
    delete process.env.MATCH_PASSWORD;
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(2);
    expect(json.error.code).toBe("MISSING_CONFIG_IOS");
    expect(importIosCredentials).not.toHaveBeenCalled();
  });

  it("an importer failure is reported as the JSON error envelope, exit 1", async () => {
    const { ShipyardError } = await import("../../src/utils/errors.js");
    vi.mocked(importIosCredentials).mockRejectedValueOnce(new ShipyardError("EAS_IOS_IMPORT_FAILED", "nope", "retry"));
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(1);
    expect(json).toEqual({ success: false, error: { code: "EAS_IOS_IMPORT_FAILED", message: "nope", fix: "retry" } });
  });
});


describe("init --from-eas merges into the existing config", () => {
  const iosSection = {
    ios: { provisioningProfilePath: "credentials/ios/profile.mobileprovision", distributionCertificate: { path: "credentials/ios/dist-cert.p12", password: "p12-secret" } },
  };
  const readConfigJson = async () => JSON.parse(await readFile(join(dir, ".shipyard", "config.json"), "utf-8"));

  it("--from-eas for ios after an android --from-eas keeps the android block and lanes", async () => {
    expect((await run()).code).toBe(0);
    const first = await readConfigJson();
    await writeFile(join(dir, "credentials.json"), JSON.stringify(iosSection));
    process.env.MATCH_GIT_URL = "git@github.com:me/certs.git";
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    process.env.MATCH_PASSWORD = "match-pw";
    out = [];
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(0);
    const after = await readConfigJson();
    expect(after.platforms.android).toEqual(first.platforms.android);
    expect(after.platforms.ios.bundleId).toBe("com.x.app");
    expect(json.setup).toMatchObject({ ios: { status: "imported" }, preserved: ["android"] });
    const ff = await readFile(join(dir, "fastlane", "Fastfile"), "utf-8");
    expect(ff).toContain("platform :android do");
    expect(ff).toContain("lane :shipyard_match_import");
  });

  it("--from-eas for android after ios keeps the ios block and the Matchfile", async () => {
    await writeFile(join(dir, "credentials.json"), JSON.stringify(iosSection));
    process.env.MATCH_GIT_URL = "git@github.com:me/certs.git";
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    process.env.MATCH_PASSWORD = "match-pw";
    expect((await run({ platform: "ios" })).code).toBe(0);
    const first = await readConfigJson();
    await easJson();
    out = [];
    const { code } = await run({ platform: "android" });
    expect(code).toBe(0);
    const after = await readConfigJson();
    expect(after.platforms.ios).toEqual(first.platforms.ios);
    expect(after.platforms.android.keystoreAlias).toBe("upload");
    expect(await exists(join(dir, "fastlane", "Matchfile"))).toBe(true);
  });

  it("--platform all with a file that has only android keeps an existing ios block", async () => {
    await mkdir(join(dir, ".shipyard"), { recursive: true });
    const ios = { enabled: true, signingMethod: "match", matchGitUrl: "git@github.com:me/certs.git", matchType: "appstore", teamId: "ABCDE12345", bundleId: "com.x.app" };
    await writeFile(join(dir, ".shipyard", "config.json"), JSON.stringify({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z", platforms: { ios }, outputDir: "./output" }));
    const { code } = await run({ platform: "all" });
    expect(code).toBe(0);
    const after = await readConfigJson();
    expect(after.platforms.ios).toEqual(ios);
    expect(after.platforms.android.keystoreAlias).toBe("upload");
    expect(after.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("init --from-eas without credentials.json", () => {
  const interactiveTty = (isTTY: boolean) => {
    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
  };
  afterEach(() => interactiveTty(false));

  it("non-interactive: EAS_CREDENTIALS_NOT_FOUND with the exact menu path and the Apple login answer; eas-cli is not started", async () => {
    await rm(join(dir, "credentials.json"));
    const { code, json } = await run({ platform: "ios" });
    expect(code).toBe(2);
    expect(json.error.code).toBe("EAS_CREDENTIALS_NOT_FOUND");
    expect(json.error.fix).toContain("npx eas-cli credentials");
    expect(json.error.fix).toContain("Do you want to log in to your Apple account?");
    expect(json.error.fix).toContain("Download credentials from EAS to credentials.json");
    expect(vi.mocked(exec).mock.calls.some(([c]) => c === "npx")).toBe(false);
  });
});

describe("init --from-eas: existing config is validated first", () => {
  it("a broken .shipyard/config.json fails with INVALID_CONFIG before the eas-cli download flow", async () => {
    await rm(join(dir, "credentials.json"));
    await mkdir(join(dir, ".shipyard"), { recursive: true });
    await writeFile(join(dir, ".shipyard", "config.json"), "{ not json");
    const { code, json } = await run();
    expect(code).toBe(1);
    expect(json.error.code).toBe("INVALID_CONFIG");
    expect(vi.mocked(exec).mock.calls.some(([c]) => c === "npx")).toBe(false);
  });
});

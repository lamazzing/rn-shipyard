import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir, access, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { dirname } from "node:path";

vi.mock("../../src/utils/shell.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/shell.js")>("../../src/utils/shell.js");
  return { ...actual, exec: vi.fn() };
});
import { exec } from "../../src/utils/shell.js";
import { importIosCredentials, extractCertificate, MATCH_IMPORT_LANE } from "../../src/platforms/ios/eas-import.js";
import { clearCleanupsForTests } from "../../src/utils/cleanup.js";

// public self-signed test certificate (CN=iPhone Distribution: Test (ABCDE12345)); no key material
const CERT_DER = Buffer.from("MIIDQDCCAiigAwIBAgIUON13+tOxXaJ5wnMDN1d4Bcrl2mMwDQYJKoZIhvcNAQELBQAwQDEvMC0GA1UEAwwmaVBob25lIERpc3RyaWJ1dGlvbjogVGVzdCAoQUJDREUxMjM0NSkxDTALBgNVBAoMBFRlc3QwHhcNMjYxMDMwMjEzMzEzWhcNMjYxMTI5MjEzMzEzWjBAMS8wLQYDVQQDDCZpUGhvbmUgRGlzdHJpYnV0aW9uOiBUZXN0IChBQkNERTEyMzQ1KTENMAsGA1UECgwEVGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK2LrAWuNy4HLxx2JZi1U72hWJtLlK/TsmuX4rnYMgx5wozeBLbOipYreYuzeWkQKzezK0s7gQpo8veXfTUaSfypG+FK9sQlwq+603C08APW2vhRl9GizTYF4j2FhgmV/gG2gK0NAtwxFu38nBX2FO1uG2OinAYMJpMrMwrz4mvIU5SI7M5qyAUV9MrZD0I+Aly7qjCbZyNuvuWFdrQNDZCZN4WzNG92VN5my8lhET+s2vjfz2iczvxVCgA+XmAm8qBiRAsTsv9i7NdMOcN3kKLvqKfEiesb3W/4vSnDM/OrVcjo90Vz4Lfg8iyIAIlInTsbHaawHzQaYobEHr7U/k0CAwEAAaMyMDAwHQYDVR0OBBYEFAmDlsRv9X1EsbtjV6XfSJzrX8u3MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAHhXvgVYkN4qKb+Pt28iGgU/CKy3lJPy9yLZTtzA9/u6hfErL2fcktSWOz2IH5FDKsrg0um/4dHUzbILpN0Lel5nxARG9DGXMtJA3ir6kWYNIaCLTOR9Z00RJDpvoUgDdi7705jc2kAx9Hv/mGNBCXC4NSusmV9Fd3n54zDP8/zC5keUSLf9GPNaqCYdKbp2/Ag8NNsmK7vncKlbOq9URYmD12ZrsvLYS7bRzxw+kWohN6aeUhBs5x/P2n/bCNQk8Hw3n8LdH+DH/K/ZbhRO8SUqBVKh4Tf0Invop2P5HdMQByK5aAZZKyDgdYmzqU0yw8pWI3Jmo6hcUCFej/RVgDM=", "base64");
const SHA256 = new X509Certificate(CERT_DER).fingerprint256;
const P12_PW = 'Eas-p12-pw!"$x';
const MATCH_PW = "match-secret-pw";
const PROFILE_PLIST = "<key>application-identifier</key><string>ABCDE12345.com.x.app</string>";

let project: string;
let files: { p12: string; profile: string; ext?: string };
let fastlaneCall: { args: string[]; opts: any } | undefined;
let workdirs: string[];
let opensslFailsWithoutLegacy: boolean;
let fastlaneExit: number;
let entriesSeen: Array<{ cer: string; p12: string; profile: string }>;
let entriesMode: number;

function tgt(name: string, profile: string, p12: string) {
  return { name, certificatePath: p12, certificatePassword: P12_PW, provisioningProfilePath: profile };
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearCleanupsForTests();
  fastlaneCall = undefined;
  workdirs = [];
  opensslFailsWithoutLegacy = false;
  fastlaneExit = 0;
  project = await realpath(await mkdtemp(join(tmpdir(), "shipyard-easios-")));
  await mkdir(join(project, "fastlane"));
  await writeFile(join(project, "fastlane", "Fastfile"), `lane :${MATCH_IMPORT_LANE} do\nend\n`);
  await mkdir(join(project, "credentials", "ios"), { recursive: true });
  files = { p12: join(project, "credentials/ios/dist-cert.p12"), profile: join(project, "credentials/ios/profile.mobileprovision") };
  await writeFile(files.p12, "p12");
  await writeFile(files.profile, "profile");

  vi.mocked(exec).mockImplementation((async (cmd: string, args: string[], o: any) => {
    if (cmd === "openssl") {
      if (opensslFailsWithoutLegacy && args[0] === "pkcs12" && !args.includes("-legacy") && args.includes("-nocerts")) {
        return { exitCode: 1, stdout: "", stderr: "unsupported" };
      }
      const out = args[args.indexOf("-out") + 1];
      workdirs.push(dirname(out));
      if (args[0] === "x509") await writeFile(out, CERT_DER);
      else await writeFile(out, "x");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (cmd === "security") return { exitCode: 0, stdout: PROFILE_PLIST, stderr: "" };
    if (cmd === "fastlane") {
      fastlaneCall = { args, opts: o };
      entriesSeen = JSON.parse(await readFile(o.env.SHIPYARD_IMPORT_ENTRIES_FILE, "utf-8"));
      entriesMode = (await stat(o.env.SHIPYARD_IMPORT_ENTRIES_FILE)).mode & 0o777;
      return { exitCode: fastlaneExit, stdout: "", stderr: fastlaneExit ? `boom ${MATCH_PW}` : "" };
    }
    if (cmd === "git") return { exitCode: 0, stdout: "", stderr: "" };
    throw new Error("unexpected " + cmd);
  }) as never);
});

const base = () => ({
  targets: [tgt("app", files.profile, files.p12)],
  gitUrl: "git@github.com:me/certs.git",
  teamId: "ABCDE12345",
  bundleId: "com.x.app",
  matchPassword: MATCH_PW,
  projectDir: project,
  interactive: false,
  stream: false,
});
const exists = (p: string) => access(p).then(() => true, () => false);

describe("extractCertificate (openssl)", () => {
  it("reads the p12 password and the key passphrase from the environment, never argv; output is a passwordless p12", async () => {
    const wd = await realpath(await mkdtemp(join(tmpdir(), "shipyard-easwd-")));
    const redact: string[] = [];
    const r = await extractCertificate(tgt("app", files.profile, files.p12), wd, 0, redact);
    expect(r.sha256).toBe(SHA256);
    const calls = vi.mocked(exec).mock.calls.filter((c) => c[0] === "openssl");
    expect(calls.length).toBe(4); // key, leaf, cer, export
    const pemPass = redact.find((s) => s !== P12_PW)!;
    expect(pemPass).toMatch(/^[0-9a-f]{48}$/);
    for (const [, args, o] of calls) {
      const argv = args.join(" ");
      expect(argv).not.toContain(P12_PW);
      expect(argv).not.toContain(pemPass);
      expect(o!.redact).toEqual(expect.arrayContaining([P12_PW, pemPass]));
      expect(o!.foreground).toBeUndefined();
    }
    const exp = calls[3][1];
    expect(exp).toEqual(expect.arrayContaining(["-export", "-passout", "pass:", "-certpbe", "PBE-SHA1-3DES", "-keypbe", "PBE-SHA1-3DES", "-macalg", "sha1"]));
    expect(calls[0][2]!.env).toMatchObject({ SHIPYARD_EAS_P12_PASSWORD: P12_PW, SHIPYARD_EAS_PEM_PASSWORD: pemPass });
    expect(calls[0][1]).toEqual(expect.arrayContaining(["-passin", "env:SHIPYARD_EAS_P12_PASSWORD", "-passout", "env:SHIPYARD_EAS_PEM_PASSWORD"]));
  });

  it("retries with -legacy (OpenSSL 3+ and old RC2 p12s) and keeps it for every later step", async () => {
    opensslFailsWithoutLegacy = true;
    const wd = await realpath(await mkdtemp(join(tmpdir(), "shipyard-easwd-")));
    await extractCertificate(tgt("app", files.profile, files.p12), wd, 0, []);
    const calls = vi.mocked(exec).mock.calls.filter((c) => c[0] === "openssl").map((c) => c[1] as string[]);
    expect(calls.length).toBe(5);
    expect(calls[0]).not.toContain("-legacy");
    expect(calls[1]).toContain("-legacy");
    expect(calls[2]).toContain("-legacy"); // leaf
    expect(calls[4]).toContain("-legacy"); // export (reads the key PEM written under legacy)
  });

  it("wrong p12 password: EAS_IOS_EXTRACT_FAILED without the password", async () => {
    vi.mocked(exec).mockImplementation((async () => ({ exitCode: 1, stdout: "", stderr: "Mac verify error: invalid password?" })) as never);
    const wd = await realpath(await mkdtemp(join(tmpdir(), "shipyard-easwd-")));
    const err = await extractCertificate(tgt("app", files.profile, files.p12), wd, 0, []).catch((e) => e);
    expect(err.code).toBe("EAS_IOS_EXTRACT_FAILED");
    expect(JSON.stringify(err.toJSON())).not.toContain(P12_PW);
  });
});

describe("importIosCredentials", () => {
  it("non-interactive: lane runs piped, detached, ssh BatchMode; secrets in env only", async () => {
    const r = await importIosCredentials(base());
    expect(fastlaneCall!.args).toEqual(["ios", MATCH_IMPORT_LANE]);
    const o = fastlaneCall!.opts;
    expect(o.foreground).toBe(false);
    expect(o.detached).toBe(true);
    expect(o.cwd).toBe(project);
    expect(o.env).toMatchObject({
      MATCH_GIT_URL: "git@github.com:me/certs.git",
      MATCH_PASSWORD: MATCH_PW,
      FASTLANE_TEAM_ID: "ABCDE12345",
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(o.env.GIT_SSH_COMMAND).toContain("BatchMode=yes");
    expect(fastlaneCall!.args.join(" ")).not.toContain(MATCH_PW);
    expect(o.redact).toEqual(expect.arrayContaining([MATCH_PW, P12_PW]));
    expect(r.targets).toEqual([
      expect.objectContaining({ target: "app", bundleId: "com.x.app", certificateSha256: SHA256, certificateExpires: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("interactive: lane runs in the foreground on the real terminal, no git env overrides", async () => {
    await importIosCredentials({ ...base(), interactive: true, stream: true });
    const o = fastlaneCall!.opts;
    expect(o.foreground).toBe(true);
    expect(o.detached).toBe(false);
    expect(o.env).not.toHaveProperty("GIT_TERMINAL_PROMPT");
    expect(o.env.MATCH_PASSWORD).toBe(MATCH_PW);
  });

  it("the entries file lists cer, p12 and profile for every target (multi-target shares one converted certificate)", async () => {
    const ext = join(project, "credentials/ios/ext-profile.mobileprovision");
    await writeFile(ext, "profile");
    await importIosCredentials({ ...base(), targets: [tgt("app", files.profile, files.p12), tgt("ext", ext, files.p12)] });
    expect(entriesSeen.map((e) => e.profile)).toEqual([files.profile, ext]);
    expect(entriesSeen[0].cer).toBe(entriesSeen[1].cer);
    expect(entriesSeen[0].p12).toMatch(/shipyard-eas-ios-.*cert0\.p12$/);
    expect(entriesMode).toBe(0o600);
    expect(vi.mocked(exec).mock.calls.filter((c) => c[0] === "openssl").length).toBe(4); // converted once
  });

  it("warns when no imported profile is for the app's bundle id", async () => {
    const r = await importIosCredentials({ ...base(), bundleId: "com.other.app" });
    expect(r.warnings[0]).toContain("com.other.app");
  });

  it("the temp workdir (0700) is removed after success", async () => {
    await importIosCredentials(base());
    const wd = dirname(fastlaneCall!.opts.env.SHIPYARD_IMPORT_ENTRIES_FILE);
    expect(wd).toContain("shipyard-eas-ios-");
    expect(await exists(wd)).toBe(false);
  });

  it("the temp workdir is removed when fastlane fails; EAS_IOS_IMPORT_FAILED never shows the Match password", async () => {
    fastlaneExit = 1;
    const err = await importIosCredentials(base()).catch((e) => e);
    expect(err.code).toBe("EAS_IOS_IMPORT_FAILED");
    expect(JSON.stringify(err.toJSON())).not.toContain(MATCH_PW);
    expect(await exists(dirname(fastlaneCall!.opts.env.SHIPYARD_IMPORT_ENTRIES_FILE))).toBe(false);
  });

  it("the temp workdir is removed when the conversion fails", async () => {
    let seen = "";
    vi.mocked(exec).mockImplementation((async (cmd: string, args: string[]) => {
      if (cmd === "openssl") {
        seen = dirname(args[args.indexOf("-out") + 1]);
        return { exitCode: 1, stdout: "", stderr: "Mac verify error: invalid password?" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }) as never);
    const err = await importIosCredentials(base()).catch((e) => e);
    expect(err.code).toBe("EAS_IOS_EXTRACT_FAILED");
    expect(seen).toContain("shipyard-eas-ios-");
    expect(await exists(seen)).toBe(false);
    expect(vi.mocked(exec).mock.calls.some((c) => c[0] === "fastlane")).toBe(false);
  });

  it("an old Fastfile without the lane asks for init to regenerate it", async () => {
    await writeFile(join(project, "fastlane", "Fastfile"), "lane :build do\nend\n");
    const err = await importIosCredentials(base()).catch((e) => e);
    expect(err.code).toBe("EAS_IOS_IMPORT_FAILED");
    expect(err.fix).toContain("init");
  });

  it("a missing profile file names the target", async () => {
    const err = await importIosCredentials({ ...base(), targets: [tgt("app", join(project, "nope.mobileprovision"), files.p12)] }).catch((e) => e);
    expect(err.code).toBe("EAS_IOS_EXTRACT_FAILED");
    expect(err.message).toContain('"app"');
  });
});

import { mkdtemp, rm, chmod, readFile, writeFile, access } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import type { EasIosTargetCredentials } from "../../core/eas-credentials.js";
import { exec, redactSecrets } from "../../utils/shell.js";
import { registerCleanup } from "../../utils/cleanup.js";
import { gitUrlSecrets } from "../../utils/secrets.js";
import { nonInteractiveGitEnv } from "../../utils/git-env.js";
import { ShipyardError } from "../../utils/errors.js";
import { resolveSshBase, safeUrl } from "./match-repo.js";

/** Internal lane in the generated Fastfile (templates/Fastfile.ejs). */
export const MATCH_IMPORT_LANE = "shipyard_match_import";

export interface ImportedIosTarget {
  target: string;
  /** Bundle id read from the provisioning profile; undefined if `security cms` could not decode it */
  bundleId?: string;
  profile: string;
  certificateSha256: string;
  certificateSubject: string;
  certificateExpires: string;
}

export interface IosEasImport {
  targets: ImportedIosTarget[];
  warnings: string[];
}

/** Fastfiles generated before this feature do not have the lane: init regenerates them. */
export async function hasMatchImportLane(projectDir: string): Promise<boolean> {
  try {
    return (await readFile(join(projectDir, "fastlane", "Fastfile"), "utf8")).includes(`lane :${MATCH_IMPORT_LANE}`);
  } catch {
    return false;
  }
}

const extractError = (message: string, fix: string) => new ShipyardError("EAS_IOS_EXTRACT_FAILED", message, fix);

interface CertFiles {
  cerPath: string;
  p12Path: string;
  sha256: string;
  subject: string;
  expires: string;
}

async function openssl(args: string[], env: Record<string, string>, redact: string[]) {
  try {
    return await exec("openssl", args, { env, redact });
  } catch (err) {
    if (err instanceof Error && err.message.includes("ENOENT")) {
      throw extractError("openssl was not found", "Install it (macOS ships one; or `brew install openssl`) and make sure it is on PATH");
    }
    throw err;
  }
}

/**
 * EAS's dist-cert.p12 has a password. Match never stores a PKCS#12: fastlane's cert runner
 * (cert/runner.rb) writes the RAW RSA private key as a traditional PEM ("BEGIN RSA PRIVATE KEY")
 * and merely names it <id>.p12; keychain_importer then runs `security import <file> -P ''`.
 * macOS 26 rejects OpenSSL 3+/4 PKCS#12 files (AES / SHA-256 MAC) and PKCS#8 PEM ("Unknown
 * format"), but imports the traditional PEM. So: read the EAS p12 (password via -passin env:),
 * write the certificate as DER (.cer, which match import needs) and the key as an UNENCRYPTED
 * traditional RSA PEM handed to match import as its "p12". Non-RSA keys are refused (Apple
 * distribution keys are RSA 2048).
 *
 * Details:
 *  - One openssl binary for every step.
 *  - OpenSSL 3+ cannot read the RC2-40 bags old p12s use without `-legacy`: try without, then
 *    with it (LibreSSL has no such flag and does not need it).
 *  - OpenSSL 3+/4 writes PKCS#8 unless `rsa -traditional`; LibreSSL writes traditional and does
 *    not know the flag. Try with it, then without.
 *  - The plaintext key exists only inside the 0700 workdir (same exposure as fastlane's own
 *    cert flow); the caller removes the workdir on success, failure and signals.
 */
export async function extractCertificate(
  target: EasIosTargetCredentials,
  workdir: string,
  index: number,
  redact: string[]
): Promise<CertFiles> {
  redact.push(target.certificatePassword);
  const env = { SHIPYARD_EAS_P12_PASSWORD: target.certificatePassword };
  const base = `cert${index}`;
  const keyPem = join(workdir, `${base}.key.pem`);
  const leafPem = join(workdir, `${base}.leaf.pem`);
  const cerPath = join(workdir, `${base}.cer`);
  const p12Path = join(workdir, `${base}.p12`);
  const fix = "Download the credentials again with `npx eas-cli credentials`; the p12 and its password must come from the same download";

  let mode: string[] | undefined;
  let lastFailure = "";
  for (const candidate of [[], ["-legacy"]]) {
    const r = await openssl(
      ["pkcs12", ...candidate, "-in", target.certificatePath, "-passin", "env:SHIPYARD_EAS_P12_PASSWORD", "-nocerts", "-nodes", "-out", keyPem],
      env, redact
    );
    if (r.exitCode === 0) {
      mode = candidate;
      break;
    }
    lastFailure = `${r.stderr}${r.stdout}`;
  }
  if (!mode) {
    const wrongPassword = /mac verify|invalid password|MAC verification/i.test(lastFailure);
    throw extractError(
      wrongPassword
        ? `openssl cannot open ${target.certificatePath} with the password from credentials.json (target "${target.name}")`
        : `openssl cannot read ${target.certificatePath} as a PKCS#12 file (target "${target.name}")`,
      fix
    );
  }
  await chmod(keyPem, 0o600);

  // key -> unencrypted traditional RSA PEM (what match stores and `security import` reads)
  let keyOk = false;
  for (const flags of [["-traditional"], []]) {
    const r = await openssl(["rsa", ...flags, "-in", keyPem, "-out", p12Path], env, redact);
    if (r.exitCode === 0) {
      keyOk = true;
      break;
    }
  }
  if (!keyOk) {
    throw extractError(
      `The distribution key of target "${target.name}" is not an RSA key`,
      "Apple distribution certificates use RSA 2048 keys; download the credentials again, or create a new distribution certificate"
    );
  }
  await rm(keyPem, { force: true });

  const steps: string[][] = [
    ["pkcs12", ...mode, "-in", target.certificatePath, "-passin", "env:SHIPYARD_EAS_P12_PASSWORD", "-clcerts", "-nokeys", "-out", leafPem],
    ["x509", "-in", leafPem, "-outform", "DER", "-out", cerPath],
  ];
  for (const args of steps) {
    const r = await openssl(args, env, redact);
    if (r.exitCode !== 0) {
      throw extractError(`openssl failed while converting the distribution certificate of target "${target.name}" (${args[0]})`, fix);
    }
  }
  await Promise.all([chmod(leafPem, 0o600), chmod(cerPath, 0o600), chmod(p12Path, 0o600)]);

  let info: X509Certificate;
  try {
    info = new X509Certificate(await readFile(cerPath));
  } catch {
    throw extractError(`The distribution certificate of target "${target.name}" could not be parsed after conversion`, fix);
  }
  return {
    cerPath,
    p12Path,
    sha256: info.fingerprint256,
    subject: info.subject.replace(/\n/g, ", "),
    expires: new Date(info.validTo).toISOString().slice(0, 10),
  };
}

/** Bundle id of a provisioning profile (macOS `security cms -D`); undefined when it cannot be read. */
export async function profileBundleId(profilePath: string): Promise<string | undefined> {
  try {
    const r = await exec("security", ["cms", "-D", "-i", profilePath]);
    if (r.exitCode !== 0) return undefined;
    const m = /<key>application-identifier<\/key>\s*<string>[A-Z0-9]{10}\.([^<]+)<\/string>/.exec(r.stdout);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export interface IosEasImportOptions {
  targets: EasIosTargetCredentials[];
  gitUrl: string;
  teamId: string;
  /** The app's bundle id (config), to check a profile for it was imported */
  bundleId: string;
  /** Absent = fastlane reads the passphrase from the macOS keychain (item match_<git url>) */
  matchPassword?: string;
  projectDir: string;
  interactive: boolean;
  stream: boolean;
}

/**
 * Imports the EAS distribution certificate and provisioning profile(s) into the Match repo with
 * `Match::Importer#import_cert` (lane shipyard_match_import): encrypts with MATCH_PASSWORD, commits
 * and PUSHES to the repo; matches the certificate against the Apple developer portal (so the
 * stored files carry the portal's certificate id). Runs in the foreground when interactive (git/ssh
 * prompts, Apple ID, 2FA); otherwise piped, detached, with ssh BatchMode, and the portal login
 * must come from an App Store Connect API key in the environment.
 *
 * The temp workdir (0700) holds the converted certificates; it is removed on success, failure and
 * signals.
 */
export async function importIosCredentials(opts: IosEasImportOptions): Promise<IosEasImport> {
  if (!(await hasMatchImportLane(opts.projectDir))) {
    throw new ShipyardError(
      "EAS_IOS_IMPORT_FAILED",
      `fastlane/Fastfile has no ${MATCH_IMPORT_LANE} lane`,
      "Run 'rn-shipyard init' again to regenerate the Fastfile"
    );
  }
  for (const t of opts.targets) {
    for (const [label, p] of [["provisioning profile", t.provisioningProfilePath], ["distribution certificate", t.certificatePath]] as const) {
      try {
        await access(p);
      } catch {
        throw extractError(
          `The ${label} for target "${t.name}" is missing: ${p}`,
          "Download the credentials again with `npx eas-cli credentials`, which writes these files next to credentials.json"
        );
      }
    }
  }

  const redact: string[] = [...(opts.matchPassword ? [opts.matchPassword] : []), ...opts.targets.map((t) => t.certificatePassword), ...gitUrlSecrets(opts.gitUrl)];
  const workdir = await mkdtemp(join(tmpdir(), "shipyard-eas-ios-"));
  await chmod(workdir, 0o700);
  const handle = registerCleanup(
    () => rm(workdir, { recursive: true, force: true }),
    () => rmSync(workdir, { recursive: true, force: true })
  );
  try {
    const certs = new Map<string, CertFiles>();
    const imported: ImportedIosTarget[] = [];
    const entries: Array<{ cer: string; p12: string; profile: string }> = [];
    for (const t of opts.targets) {
      // targets that share one p12 file are converted once
      let files = certs.get(t.certificatePath);
      if (!files) {
        files = await extractCertificate(t, workdir, certs.size, redact);
        certs.set(t.certificatePath, files);
      }
      entries.push({ cer: files.cerPath, p12: files.p12Path, profile: t.provisioningProfilePath });
      imported.push({
        target: t.name,
        bundleId: await profileBundleId(t.provisioningProfilePath),
        profile: t.provisioningProfilePath,
        certificateSha256: files.sha256,
        certificateSubject: files.subject,
        certificateExpires: files.expires,
      });
    }
    const entriesFile = join(workdir, "entries.json");
    await writeFile(entriesFile, JSON.stringify(entries), { mode: 0o600 });
    redact.push(workdir);

    const gitEnv = opts.interactive ? {} : nonInteractiveGitEnv(await resolveSshBase(), 15);
    let result;
    try {
      result = await exec("fastlane", ["ios", MATCH_IMPORT_LANE], {
        cwd: opts.projectDir,
        stream: opts.stream,
        // interactive: the user's terminal (git/ssh, Apple ID, 2FA); otherwise fully piped
        foreground: opts.interactive,
        detached: !opts.interactive,
        redact,
        env: {
          ...gitEnv,
          MATCH_GIT_URL: opts.gitUrl,
          MATCH_PASSWORD: opts.matchPassword,
          FASTLANE_TEAM_ID: opts.teamId,
          SHIPYARD_IMPORT_ENTRIES_FILE: entriesFile,
        },
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("ENOENT")) {
        throw new ShipyardError("FASTLANE_NOT_FOUND", "Fastlane is not installed", "Install Fastlane: gem install fastlane");
      }
      throw err;
    }
    if (result.exitCode !== 0) {
      const tail = opts.interactive
        ? "see the fastlane output above"
        : redactSecrets((result.stderr || result.stdout).trim().split("\n").slice(-4).join(" ").slice(0, 300), redact);
      throw new ShipyardError(
        "EAS_IOS_IMPORT_FAILED",
        `fastlane match import into ${safeUrl(opts.gitUrl)} failed (exit ${result.exitCode}${tail ? `: ${tail}` : ""})`,
        opts.interactive
          ? "Fix the problem shown above and re-run the same command. Nothing in .shipyard/ was written yet (only fastlane/ files); the import is safe to repeat"
          : "Run without --non-interactive to sign in to Apple and git on your terminal, or set an App Store Connect API key (APP_STORE_CONNECT_API_KEY_KEY_ID, _ISSUER_ID, _KEY_FILEPATH) and git access (ssh-agent or MATCH_GIT_BASIC_AUTHORIZATION)"
      );
    }

    const warnings: string[] = [];
    if (opts.bundleId && !imported.some((t) => t.bundleId === opts.bundleId)) {
      const known = imported.map((t) => t.bundleId).filter(Boolean);
      warnings.push(
        `None of the imported provisioning profiles is for ${opts.bundleId}${known.length ? ` (found: ${known.join(", ")})` : ""}. The build looks for the profile of ios.bundleId in the Match repo`
      );
    }
    return { targets: imported, warnings };
  } finally {
    await handle.run();
    handle.unregister();
  }
}

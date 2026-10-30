import { readFile, writeFile, mkdir, chmod, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EasAndroidCredentials } from "../../core/eas-credentials.js";
import { exec } from "../../utils/shell.js";
import { ShipyardError } from "../../utils/errors.js";

export const IMPORTED_KEYSTORE_NAME = "release.keystore";
export const IMPORTED_CREDENTIALS_NAME = "android-credentials.json";

export interface AndroidEasImport {
  /** Absolute paths of the copies under ~/.config/rn-shipyard/<slug>/ */
  dir: string;
  keystorePath: string;
  credentialsPath: string;
  keyAlias: string;
  /** Upload-key certificate SHA-256, as keytool prints it (AA:BB:...) */
  sha256: string;
  /** Previous, different keystore that was kept under this name instead of being overwritten */
  backupPath?: string;
  /** The same keystore was already there */
  unchanged: boolean;
}

/** ~/.config/rn-shipyard/<slug>: where per-app secrets live, outside every repository. */
export function secretsDirFor(slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "app";
  return join(homedir(), ".config", "rn-shipyard", safe);
}

const ENV = { store: "SHIPYARD_EAS_STOREPASS", key: "SHIPYARD_EAS_KEYPASS" } as const;

function keystoreError(message: string, fix: string): ShipyardError {
  return new ShipyardError("EAS_KEYSTORE_INVALID", message, fix);
}

async function keytool(args: string[], creds: EasAndroidCredentials) {
  try {
    return await exec("keytool", args, {
      // passwords travel in the environment only (keytool -storepass:env), never in argv
      env: { [ENV.store]: creds.keystorePassword, [ENV.key]: creds.keyPassword },
      redact: [creds.keystorePassword, creds.keyPassword],
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("ENOENT")) {
      throw new ShipyardError(
        "KEYTOOL_NOT_FOUND",
        "keytool was not found",
        "Install a JDK (brew install openjdk) and make sure keytool is on PATH"
      );
    }
    throw err;
  }
}

function firstLine(text: string): string {
  return (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 200);
}

/**
 * Opens the keystore with the stored passwords, checks the alias exists and that the key
 * password unlocks it, and returns the certificate's SHA-256 fingerprint.
 */
export async function verifyKeystore(keystorePath: string, creds: EasAndroidCredentials): Promise<string> {
  const refetch = "Download the credentials again with `npx eas-cli credentials`";
  const list = await keytool(
    ["-list", "-v", "-keystore", keystorePath, "-alias", creds.keyAlias, `-storepass:env`, ENV.store],
    creds
  );
  const out = `${list.stdout}\n${list.stderr}`;
  if (list.exitCode !== 0) {
    if (/does not exist/i.test(out)) {
      throw keystoreError(
        `The key alias "${creds.keyAlias}" does not exist in the keystore`,
        `Check keyAlias in credentials.json against \`keytool -list -keystore <file>\`. ${refetch}`
      );
    }
    throw keystoreError(
      `keytool cannot open the keystore with the password from credentials.json${firstLine(out) ? ` (${firstLine(out)})` : ""}`,
      `${refetch}; the keystore file and its password must come from the same download`
    );
  }
  const m = /SHA-?256:\s*((?:[0-9A-F]{2}:){31}[0-9A-F]{2})/i.exec(out);
  if (!m) {
    throw keystoreError("keytool did not report a SHA-256 certificate fingerprint for the alias", refetch);
  }

  // -certreq needs the private key: it fails when the key password is wrong. The CSR (public) goes to stdout.
  const key = await keytool(
    ["-certreq", "-alias", creds.keyAlias, "-keystore", keystorePath, `-storepass:env`, ENV.store, `-keypass:env`, ENV.key],
    creds
  );
  if (key.exitCode !== 0) {
    throw keystoreError(
      "The key password from credentials.json does not unlock the key",
      `${refetch}, or fix keyPassword in credentials.json`
    );
  }
  return m[1].toUpperCase();
}

async function sameBytes(a: string, b: Buffer): Promise<boolean | undefined> {
  try {
    return (await readFile(a)).equals(b);
  } catch {
    return undefined; // does not exist
  }
}

/**
 * Copies the EAS keystore to ~/.config/rn-shipyard/<slug>/ (dir 0700, files 0600) and writes
 * rn-shipyard's own credentials file next to it (the format loadAndroidCredentials reads).
 * Verifies the keystore first. A different keystore already in the target is never overwritten
 * without `confirmReplace` saying yes (non-interactive: pass undefined, which errors); the old
 * one is renamed, not deleted.
 */
export async function importAndroidKeystore(opts: {
  creds: EasAndroidCredentials;
  slug: string;
  confirmReplace?: (existingPath: string) => Promise<boolean>;
}): Promise<AndroidEasImport> {
  const { creds } = opts;
  let bytes: Buffer;
  try {
    bytes = await readFile(creds.keystorePath);
  } catch {
    throw keystoreError(
      `The keystore file named in credentials.json is missing: ${creds.keystorePath}`,
      "Download the credentials again with `npx eas-cli credentials`, which writes the keystore next to credentials.json"
    );
  }
  const sha256 = await verifyKeystore(creds.keystorePath, creds);

  const dir = secretsDirFor(opts.slug);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const keystorePath = join(dir, IMPORTED_KEYSTORE_NAME);
  const credentialsPath = join(dir, IMPORTED_CREDENTIALS_NAME);

  let backupPath: string | undefined;
  const same = await sameBytes(keystorePath, bytes);
  if (same === false) {
    const ok = opts.confirmReplace ? await opts.confirmReplace(keystorePath) : false;
    if (!ok) {
      throw new ShipyardError(
        "EAS_KEYSTORE_EXISTS",
        `A different keystore already exists at ${keystorePath}; it was not overwritten`,
        opts.confirmReplace
          ? "Keep using it (omit --from-eas for Android), or answer y to replace it (the old file is kept as a .bak copy)"
          : `Move or rename it yourself, or run \`rn-shipyard init --from-eas\` in a terminal to be asked. It may be your only copy of an upload key: back it up before replacing it`
      );
    }
    backupPath = `${keystorePath}.bak-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
    await rename(keystorePath, backupPath);
  }
  if (same !== true) {
    await writeFile(keystorePath, bytes, { mode: 0o600 });
  }
  await chmod(keystorePath, 0o600);

  const file = {
    keystorePassword: creds.keystorePassword,
    keyAlias: creds.keyAlias,
    keyPassword: creds.keyPassword,
  };
  await writeFile(credentialsPath, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  await chmod(credentialsPath, 0o600);

  return { dir, keystorePath, credentialsPath, keyAlias: creds.keyAlias, sha256, backupPath, unchanged: same === true };
}

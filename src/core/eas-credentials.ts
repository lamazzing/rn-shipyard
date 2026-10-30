import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ShipyardError } from "../utils/errors.js";

/**
 * Reader for the credentials.json that `eas credentials` writes ("Download credentials from EAS
 * to credentials.json"). Same shape and rules as eas-cli's schema (credentialsJson/types.js):
 *
 *   { android?: { keystore: { keystorePath, keystorePassword, keyAlias, keyPassword? } },
 *     ios?: Target | { [targetName]: Target } }
 *   Target = { provisioningProfilePath, distributionCertificate: { path, password } }
 *
 * Relative paths are relative to the directory of credentials.json (eas-cli getAbsolutePath).
 * Values are never echoed in error messages: the file holds passwords.
 */
export interface EasAndroidCredentials {
  keystorePath: string;
  keystorePassword: string;
  keyAlias: string;
  /** Absent in the file means "same as the keystore password" */
  keyPassword: string;
}

export interface EasIosTargetCredentials {
  /** Target name (multi-target) or "app" for the single-target form */
  name: string;
  certificatePath: string;
  certificatePassword: string;
  provisioningProfilePath: string;
}

export interface EasCredentials {
  file: string;
  dir: string;
  android?: EasAndroidCredentials;
  ios?: EasIosTargetCredentials[];
}

export const EAS_DOWNLOAD_FIX =
  'Run `npx eas-cli credentials`, choose the platform, then "credentials.json: Upload/Download credentials between EAS servers and your local json" and "Download credentials from EAS to credentials.json". Run it in your project folder, then re-run this command (or pass the file path: --from-eas <path>)';

function invalid(file: string, detail: string): ShipyardError {
  return new ShipyardError(
    "EAS_CREDENTIALS_INVALID",
    `${file} is not a valid EAS credentials.json: ${detail}`,
    "Download it again (`npx eas-cli credentials` -> credentials.json -> Download credentials from EAS to credentials.json) and do not edit it by hand"
  );
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function absolute(dir: string, p: string): string {
  return isAbsolute(p) ? p : join(dir, p);
}

/** `pathArg` is the credentials.json file, or a folder that contains one. Default: ./credentials.json */
export async function readEasCredentials(projectDir: string, pathArg?: string): Promise<EasCredentials> {
  let file = resolve(projectDir, pathArg && pathArg.trim() ? pathArg : "credentials.json");
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "credentials.json");
  } catch {
    // reported below
  }

  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new ShipyardError("EAS_CREDENTIALS_NOT_FOUND", `No EAS credentials file at ${file}`, EAS_DOWNLOAD_FIX);
    }
    throw invalid(file, "the file cannot be read");
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw invalid(file, "it is not valid JSON");
  }
  if (!isObject(data)) throw invalid(file, "the top level must be a JSON object");

  const dir = dirname(file);
  const out: EasCredentials = { file, dir };

  if (data.android !== undefined) {
    const ks = isObject(data.android) ? data.android.keystore : undefined;
    if (!isObject(ks)) throw invalid(file, "android.keystore is missing");
    if (!nonEmpty(ks.keystorePath)) throw invalid(file, "android.keystore.keystorePath is missing");
    if (!str(ks.keystorePassword)) throw invalid(file, "android.keystore.keystorePassword is missing");
    if (!nonEmpty(ks.keyAlias)) throw invalid(file, "android.keystore.keyAlias is missing");
    if (ks.keyPassword !== undefined && ks.keyPassword !== null && !str(ks.keyPassword)) {
      throw invalid(file, "android.keystore.keyPassword must be a string");
    }
    out.android = {
      keystorePath: absolute(dir, ks.keystorePath),
      keystorePassword: ks.keystorePassword,
      keyAlias: ks.keyAlias,
      keyPassword: nonEmpty(ks.keyPassword) ? ks.keyPassword : ks.keystorePassword,
    };
  }

  if (data.ios !== undefined) {
    const ios = data.ios;
    if (!isObject(ios)) throw invalid(file, "ios must be an object");
    const target = (name: string, t: unknown, where: string): EasIosTargetCredentials => {
      if (!isObject(t)) throw invalid(file, `${where} must be an object`);
      const cert = t.distributionCertificate;
      if (!nonEmpty(t.provisioningProfilePath)) throw invalid(file, `${where}.provisioningProfilePath is missing`);
      if (!isObject(cert) || !nonEmpty(cert.path)) throw invalid(file, `${where}.distributionCertificate.path is missing`);
      if (!str(cert.password)) throw invalid(file, `${where}.distributionCertificate.password is missing`);
      return {
        name,
        certificatePath: absolute(dir, cert.path),
        certificatePassword: cert.password,
        provisioningProfilePath: absolute(dir, t.provisioningProfilePath),
      };
    };
    // eas-cli isCredentialsMap: a string provisioningProfilePath means the single-target form
    if (typeof ios.provisioningProfilePath === "string") {
      out.ios = [target("app", ios, "ios")];
    } else {
      const names = Object.keys(ios);
      if (names.length === 0) throw invalid(file, "ios has no targets");
      out.ios = names.map((n) => target(n, ios[n], `ios.${n}`));
    }
  }

  if (!out.android && !out.ios) throw invalid(file, "it has neither an android nor an ios section");
  return out;
}

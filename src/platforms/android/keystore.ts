import { access, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { exec } from "../../utils/shell.js";
import { ShipyardError } from "../../utils/errors.js";

export interface KeystoreOptions {
  outputPath: string;
  alias: string;
  password: string;
  keyPassword: string;
  dname?: string;
}

export async function generateKeystore(
  opts: KeystoreOptions
): Promise<{ created: boolean; path: string }> {
  // Check if keystore already exists
  try {
    await access(opts.outputPath);
    return { created: false, path: opts.outputPath };
  } catch {
    // Doesn't exist, create it
  }

  // Ensure directory exists
  await mkdir(dirname(opts.outputPath), { recursive: true });

  const dname =
    opts.dname ?? "CN=Release,OU=Development,O=IndieApp,L=City,ST=State,C=US";

  let result;
  try {
    result = await exec("keytool", [
    "-genkeypair",
    "-v",
    "-keystore",
    opts.outputPath,
    "-alias",
    opts.alias,
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "10000",
    // passwords are read from the environment so they never appear in argv (`ps`)
    "-storepass:env",
    "SHIPYARD_KEYSTORE_PASSWORD",
    "-keypass:env",
    "SHIPYARD_KEY_PASSWORD",
    "-dname",
    dname,
  ], {
    env: {
      SHIPYARD_KEYSTORE_PASSWORD: opts.password,
      SHIPYARD_KEY_PASSWORD: opts.keyPassword,
    },
    redact: [opts.password, opts.keyPassword],
  });
  } catch (err) {
    const notFound = err instanceof Error && err.message.includes("ENOENT");
    throw new ShipyardError(
      notFound ? "KEYTOOL_NOT_FOUND" : "KEYSTORE_GENERATION_FAILED",
      notFound ? "keytool was not found" : "Keystore generation failed",
      notFound ? "Install a JDK (brew install openjdk) and make sure keytool is on PATH" : "Check that keytool runs, then retry"
    );
  }

  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(0, 3).join(" ");
    throw new ShipyardError(
      "KEYSTORE_GENERATION_FAILED",
      `Keystore generation failed (keytool exit ${result.exitCode})${detail ? `: ${detail}` : ""}`,
      "Check the keytool message above (passwords need 6+ characters), or pass an existing keystore with --android-keystore"
    );
  }

  return { created: true, path: opts.outputPath };
}

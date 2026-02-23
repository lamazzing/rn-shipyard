import { access, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { exec } from "../../utils/shell.js";

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

  const result = await exec("keytool", [
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
    "-storepass",
    opts.password,
    "-keypass",
    opts.keyPassword,
    "-dname",
    dname,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Keystore generation failed: ${result.stderr}`);
  }

  return { created: true, path: opts.outputPath };
}

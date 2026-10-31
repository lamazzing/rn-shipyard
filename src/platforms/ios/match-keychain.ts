import { exec } from "../../utils/shell.js";
import { gitUrlSecrets } from "../../utils/secrets.js";

/**
 * fastlane match keeps its passphrase in the macOS keychain when MATCH_PASSWORD is not set.
 * match/lib/match/encryption/openssl.rb (fetch_password!): ENV["MATCH_PASSWORD"], else
 * Security::InternetPassword.find(server: "match_" + keychain_name); match/lib/match/encryption.rb
 * sets keychain_name = git_url. store_password adds the item with account "" (security gem
 * password.rb: InternetPassword.add(server, "", password)). So the item match itself reads is the
 * internet password with server "match_<git url as written in the Matchfile>".
 */
export function matchKeychainServer(gitUrl: string): string {
  return `match_${gitUrl}`;
}

/**
 * True when the keychain holds the Match passphrase for this git URL. Uses the exit code only:
 * without -w/-g `security` prints attributes, never the password. Exit 0 = the item exists.
 */
export async function hasMatchPasswordInKeychain(gitUrl: string): Promise<boolean> {
  // A URL that carries credentials (never written by init) must not be put into argv
  if (!gitUrl || gitUrlSecrets(gitUrl).length > 0) return false;
  try {
    const r = await exec("security", ["find-internet-password", "-s", matchKeychainServer(gitUrl)]);
    return r?.exitCode === 0;
  } catch {
    return false; // no `security` binary (not macOS) or it could not start
  }
}

/**
 * Stores the passphrase in the item match reads. `-w` is the LAST argument, so `security` itself
 * asks for the password on the terminal (twice): the secret never appears in argv or in our
 * process. `-U` updates an existing item. Interactive only: runs in the foreground.
 */
export async function storeMatchPasswordInKeychain(gitUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const r = await exec("security", ["add-internet-password", "-a", "", "-s", matchKeychainServer(gitUrl), "-U", "-w"], {
      foreground: true,
    });
    if (r.exitCode === 0) return { success: true };
    return { success: false, error: `security exited with code ${r.exitCode}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const MAX_PASSWORD_BYTES = 1024;
const securityQuote = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Stores a passphrase that is already known (MATCH_PASSWORD, `init --save-match-password`) in the
 * same item. The password must not reach argv (`ps` shows it), so the command goes to
 * `security -i` on stdin, which reads commands line by line; `-w` is still the last option.
 * Works without a terminal. The password is never in the result or in any message.
 */
export async function storeMatchPasswordValueInKeychain(
  gitUrl: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  if (!gitUrl || gitUrlSecrets(gitUrl).length > 0) return { success: false, error: "the Match git URL is empty or carries credentials" };
  // a line break would end the command and start a new one
  // `security -i` reads lines of about 4 KB: a longer one is cut and the rest would run as a new command
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    return { success: false, error: `the password is longer than ${MAX_PASSWORD_BYTES} bytes, which the macOS keychain command cannot take safely` };
  }
  if (!password || /[\r\n\0]/.test(password) || /[\r\n\0]/.test(gitUrl)) {
    return { success: false, error: "the password is empty or contains a line break or NUL character" };
  }
  try {
    const r = await exec("security", ["-i"], {
      input: `add-internet-password -a "" -s ${securityQuote(matchKeychainServer(gitUrl))} -U -w ${securityQuote(password)}\n`,
      redact: [password],
    });
    if (r.exitCode === 0) return { success: true };
    return { success: false, error: `security exited with code ${r.exitCode}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message.replaceAll(password, "***") : String(err) };
  }
}

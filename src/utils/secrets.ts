/**
 * Central list of environment variables whose values are secrets. The shell layer
 * redacts these from every spawned process's output by default, so a new call site
 * cannot forget to.
 */
export const SECRET_ENV_VARS = [
  "MATCH_PASSWORD",
  "MATCH_GIT_BASIC_AUTHORIZATION",
  "MATCH_GIT_BEARER_AUTHORIZATION",
  "MATCH_KEYCHAIN_PASSWORD",
  "MATCH_GIT_PRIVATE_KEY",
  "FASTLANE_PASSWORD",
  "EXPO_APPLE_PASSWORD",
  "EXPO_APPLE_APP_SPECIFIC_PASSWORD",
  "FASTLANE_SESSION",
  "FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD",
  "APP_STORE_CONNECT_API_KEY_KEY",
  "SUPPLY_JSON_KEY_DATA",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_PASSWORD",
  "ORG_GRADLE_PROJECT_android.injected.signing.store.password",
  "ORG_GRADLE_PROJECT_android.injected.signing.key.password",
];

/** PEM header/footer lines are public text, not secret, and would garble output. */
export function isPemBoundary(line: string): boolean {
  return /^-----(BEGIN|END) [A-Z0-9 ]+-----$/.test(line.trim());
}

/** Lines shorter than this in a multi-line secret ("{", "}", "") are structure, not secret. */
const MIN_MULTILINE_LINE = 4;

/**
 * Secret parts of a git remote URL: the password and `user:pass` of
 * https://user:pass@host/..., or the token of https://TOKEN@host/... . The user of an
 * ssh:// URL (usually `git`) is not secret. Raw and percent-decoded forms are returned.
 * scp-style URLs (git@host:path) carry no secret.
 */
export function gitUrlSecrets(url: string | undefined): string[] {
  if (!url) return [];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const dec = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  const out = new Set<string>();
  const add = (v: string) => {
    if (v) {
      out.add(v);
      out.add(dec(v));
    }
  };
  if (u.password) {
    add(u.password);
    add(`${u.username}:${u.password}`);
  } else if (u.username && /^https?:$/.test(u.protocol)) {
    add(u.username); // https://<token>@host
  }
  return [...out];
}

function expand(name: string, value: string): string[] {
  if (name === "MATCH_GIT_URL") return gitUrlSecrets(value);
  const out: string[] = [];
  if (/[\r\n]/.test(value)) {
    for (const line of value.split(/\r\n|\n|\r/)) {
      if (line.trim().length >= MIN_MULTILINE_LINE && !isPemBoundary(line)) out.push(line);
    }
  } else if (!isPemBoundary(value)) {
    out.push(value);
  }
  if (name === "MATCH_GIT_BASIC_AUTHORIZATION") {
    // base64("user:token"): the decoded credentials may be echoed too
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded.includes(":") && /^[\x20-\x7e]+$/.test(decoded)) {
      out.push(decoded);
      out.push(decoded.slice(decoded.indexOf(":") + 1)); // the token alone
    }
  }
  if (name === "MATCH_GIT_BEARER_AUTHORIZATION") {
    const token = value.replace(/^Bearer\s+/i, "");
    if (token && token !== value) out.push(token);
  }
  if (name === "SUPPLY_JSON_KEY_DATA") {
    try {
      const json = JSON.parse(value) as Record<string, unknown>;
      for (const k of ["private_key", "private_key_id"]) {
        const v = json[k];
        if (typeof v === "string") out.push(...expand(k, v));
      }
    } catch {
      // not JSON: the raw value is already covered
    }
  }
  return out;
}

/**
 * Secret values found in `env` (the merged environment given to the child),
 * plus any explicitly supplied `extra` values. Empty values are dropped.
 */
export function collectSecrets(
  env: Record<string, string | undefined> = {},
  extra: string[] = []
): string[] {
  const out = new Set<string>();
  for (const name of [...SECRET_ENV_VARS, "MATCH_GIT_URL"]) {
    const value = env[name];
    if (value) for (const s of expand(name, value)) out.add(s);
  }
  for (const s of extra) if (s) out.add(s);
  return [...out];
}

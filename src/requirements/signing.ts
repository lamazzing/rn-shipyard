import { readFile } from "node:fs/promises";
import { resolvePath, toPortablePath } from "../core/paths.js";
import { nonInteractiveGitEnv, NON_INTERACTIVE_GIT_ARGS } from "../utils/git-env.js";
import { gitUrlSecrets } from "../utils/secrets.js";
import { checkIosSubmitCredentials } from "../platforms/ios/submit.js";
import { type CheckDef, type CheckContext, type Outcome, DOCS_BASE } from "./types.js";
import { tryExec, isFile } from "./helpers.js";

const MATCH_DOCS = `${DOCS_BASE}ios-fastlane-match`;
const SUBMIT_DOCS = `${DOCS_BASE}ios-credentials-for-submit`;
const ANDROID_DOCS = `${DOCS_BASE}android-keystore--credentials-file`;
const ENV_DOCS = `${DOCS_BASE}environment-variables`;

const MATCH_REACH_TIMEOUT_MS = 12_000;

async function iosConfig(ctx: CheckContext) {
  const c = await ctx.config();
  return c.state === "ok" && c.config.platforms.ios && c.config.platforms.ios.enabled !== false
    ? c.config.platforms.ios
    : undefined;
}

async function androidConfig(ctx: CheckContext) {
  const c = await ctx.config();
  return c.state === "ok" && c.config.platforms.android && c.config.platforms.android.enabled !== false
    ? c.config.platforms.android
    : undefined;
}

/**
 * The git URL without credentials, query string or fragment, safe to print. Only a bare
 * scp-style `user@host:path` passes through unchanged (its user is not a secret).
 */
export function displayGitUrl(url: string): string {
  try {
    const u = new URL(url);
    const hadUserinfo = !!(u.username || u.password);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    const text = u.toString();
    return hadUserinfo ? text.replace("://", "://***@") : text;
  } catch {
    // Unparseable (e.g. a bad port): scrub by pattern instead of echoing the raw string
    return url.replace(/[?#].*$/, "").replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1***@");
  }
}

function unreachableReason(stderr: string): string {
  if (/permission denied|publickey/i.test(stderr)) return "SSH key not accepted";
  if (/could not read (username|password)|terminal prompts disabled|authentication failed/i.test(stderr)) {
    return "needs a username/password or token";
  }
  if (/could not resolve host|name or service not known/i.test(stderr)) return "host not found (offline?)";
  if (/not found|does not exist|repository/i.test(stderr)) return "repository not found";
  return "not reachable";
}

type CredentialsFile =
  | { state: "none" }
  | { state: "ok"; data: Record<string, unknown> }
  | { state: "error"; path: string };

async function readCredentialsFile(ctx: CheckContext): Promise<CredentialsFile> {
  const android = await androidConfig(ctx);
  if (!android?.credentialsPath) return { state: "none" };
  const path = resolvePath(ctx.projectDir, android.credentialsPath);
  try {
    const data = JSON.parse(await readFile(path, "utf-8"));
    if (data && typeof data === "object" && !Array.isArray(data)) return { state: "ok", data };
  } catch {
    // fall through
  }
  return { state: "error", path };
}

export const signingChecks: CheckDef[] = [
  {
    id: "match-password",
    group: "Signing & submit",
    title: "MATCH_PASSWORD (decrypts your certificates)",
    blocks: ["build-ios"],
    applies: async (ctx) => !!(await iosConfig(ctx)),
    async run(ctx) {
      if (ctx.env.MATCH_PASSWORD) return { status: "pass", detail: "set" };
      const fix = "export MATCH_PASSWORD=<the password you chose for the certificates repo>";
      if (ctx.nonInteractive) {
        return { status: "fail", detail: "not set, and --non-interactive cannot ask for it", fix, docs: MATCH_DOCS };
      }
      return { status: "warn", detail: "not set; the build will ask for it", fix, docs: MATCH_DOCS };
    },
  },
  {
    id: "match-repo",
    group: "Signing & submit",
    title: "Match certificates repo reachable",
    blocks: ["build-ios"],
    applies: async (ctx) => !!(await iosConfig(ctx)),
    async run(ctx) {
      const ios = await iosConfig(ctx);
      const url = ctx.env.MATCH_GIT_URL || ios?.matchGitUrl;
      if (!url) {
        return {
          status: "fail",
          detail: "no matchGitUrl in .shipyard/config.json and MATCH_GIT_URL is not set",
          fix: "rn-shipyard init --platform ios",
          docs: MATCH_DOCS,
        };
      }
      const shown = displayGitUrl(url);
      let sshBase = ctx.env.GIT_SSH_COMMAND;
      if (!sshBase) {
        const cfg = await tryExec("git", ["config", "--get", "core.sshCommand"], { cwd: ctx.projectDir, timeout: 5_000 });
        sshBase = cfg && cfg.exitCode === 0 && cfg.stdout.trim() ? cfg.stdout.trim() : "ssh";
      }
      // `--`: a URL starting with "-" must never be read as a git option
      const r = await tryExec("git", [...NON_INTERACTIVE_GIT_ARGS, "ls-remote", "--", url], {
        timeout: MATCH_REACH_TIMEOUT_MS,
        redact: gitUrlSecrets(url),
        env: nonInteractiveGitEnv(sshBase),
      });
      if (r && r.exitCode === 0) return { status: "pass", detail: shown };
      const reason = unreachableReason(r?.stderr ?? "");
      const headerAuth =
        !!(ctx.env.MATCH_GIT_BASIC_AUTHORIZATION || ctx.env.MATCH_GIT_BEARER_AUTHORIZATION) &&
        /^https?:/i.test(url);
      const note = headerAuth
        ? " (MATCH_GIT_BASIC_AUTHORIZATION / MATCH_GIT_BEARER_AUTHORIZATION are fastlane headers that `git ls-remote` cannot use, so this may be a false alarm)"
        : "";
      return {
        status: "warn",
        detail: `${shown}: ${reason} without prompting${note}`,
        fix: ctx.nonInteractive
          ? "--non-interactive and CI cannot type credentials: load your key with `ssh-add`, or set up a git credential helper (`git config --global credential.helper osxkeychain`), then check `git ls-remote <your repo>` works"
          : "An interactive build will ask for credentials. For --non-interactive or CI, load your key with `ssh-add` or set up a git credential helper (`git config --global credential.helper osxkeychain`)",
        docs: MATCH_DOCS,
      };
    },
  },
  {
    id: "ios-submit-auth",
    group: "Signing & submit",
    title: "App Store Connect login (for submit)",
    blocks: ["submit-ios"],
    applies: async (ctx) => !!(await iosConfig(ctx)),
    async run(ctx) {
      const eas = await ctx.eas();
      const problems = await checkIosSubmitCredentials(eas.appleId, ctx.env);
      if (problems.length === 0) {
        const apiKey = !!ctx.env.APP_STORE_CONNECT_API_KEY_KEY_ID;
        return { status: "pass", detail: apiKey ? "App Store Connect API key set" : "Apple ID and password found" };
      }
      return {
        status: "fail",
        detail: "no App Store Connect credentials",
        fix: "Set APP_STORE_CONNECT_API_KEY_KEY_ID, APP_STORE_CONNECT_API_KEY_ISSUER_ID and APP_STORE_CONNECT_API_KEY_KEY_FILEPATH (path to the .p8), or use an Apple ID: set submit.<profile>.ios.appleId in eas.json (or FASTLANE_USER) plus FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD (create one at appleid.apple.com)",
        docs: SUBMIT_DOCS,
      };
    },
  },
  {
    id: "android-keystore",
    group: "Signing & submit",
    title: "Android keystore file",
    blocks: ["build-android"],
    applies: async (ctx) => !!(await androidConfig(ctx)),
    async run(ctx) {
      const android = (await androidConfig(ctx))!;
      const path = resolvePath(ctx.projectDir, android.keystorePath);
      if (await isFile(path)) return { status: "pass", detail: toPortablePath(ctx.projectDir, path) };
      return {
        status: "fail",
        detail: `not found at ${toPortablePath(ctx.projectDir, path)}`,
        fix: "rn-shipyard init --platform android   (or fix keystorePath in .shipyard/config.json)",
        docs: ANDROID_DOCS,
      };
    },
  },
  {
    id: "android-credentials-file",
    group: "Signing & submit",
    title: "Android credentials file",
    blocks: ["build-android"],
    applies: async (ctx) => !!(await androidConfig(ctx)),
    async run(ctx) {
      const f = await readCredentialsFile(ctx);
      if (f.state === "none") return { status: "skip", detail: "none configured (passwords come from the environment)" };
      if (f.state === "ok") return { status: "pass", detail: "readable JSON" };
      return {
        status: "fail",
        detail: `cannot read ${toPortablePath(ctx.projectDir, f.path)} as JSON`,
        fix: 'Fix credentialsPath in .shipyard/config.json; the file must look like {"keystorePassword": "...", "keyAlias": "...", "keyPassword": "..."}',
        docs: ANDROID_DOCS,
      };
    },
  },
  {
    id: "android-passwords",
    group: "Signing & submit",
    title: "Android keystore password",
    blocks: ["build-android"],
    applies: async (ctx) => !!(await androidConfig(ctx)),
    async run(ctx) {
      if (ctx.env.ANDROID_KEYSTORE_PASSWORD) return { status: "pass", detail: "ANDROID_KEYSTORE_PASSWORD set" };
      const f = await readCredentialsFile(ctx);
      if (f.state === "ok" && typeof f.data.keystorePassword === "string" && f.data.keystorePassword) {
        return { status: "pass", detail: "found in the credentials file" };
      }
      return {
        status: "fail",
        detail: "no keystore password available",
        fix: "export ANDROID_KEYSTORE_PASSWORD=<password>, or add keystorePassword to the credentials file",
        docs: ENV_DOCS,
      };
    },
  },
  {
    id: "play-service-account",
    group: "Signing & submit",
    title: "Google Play service-account key (for submit)",
    blocks: ["submit-android"],
    applies: async (ctx) => !!(await androidConfig(ctx)),
    async run(ctx): Promise<Outcome> {
      if (ctx.env.SUPPLY_JSON_KEY_DATA) return { status: "pass", detail: "SUPPLY_JSON_KEY_DATA set" };
      const android = (await androidConfig(ctx))!;
      const eas = await ctx.eas();
      const raw = ctx.env.SUPPLY_JSON_KEY || android.serviceAccountKeyPath || eas.serviceAccountKeyPath;
      if (!raw) {
        return {
          status: "fail",
          detail: "no service-account key configured",
          fix: "Create a service account in Google Cloud, grant it access in Play Console, then: export SUPPLY_JSON_KEY=~/keys/play-service-account.json (or set submit.<profile>.android.serviceAccountKeyPath in eas.json)",
          docs: ANDROID_DOCS,
        };
      }
      const path = resolvePath(ctx.projectDir, raw);
      try {
        const key = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
        if (typeof key.client_email === "string" && typeof key.private_key === "string") {
          return { status: "pass", detail: toPortablePath(ctx.projectDir, path) };
        }
        return {
          status: "fail",
          detail: `${toPortablePath(ctx.projectDir, path)} is not a service-account key (client_email or private_key missing)`,
          fix: "Download a new JSON key from Google Cloud > IAM > Service accounts > Keys",
          docs: ANDROID_DOCS,
        };
      } catch {
        return {
          status: "fail",
          detail: `cannot read ${toPortablePath(ctx.projectDir, path)}`,
          fix: "Check the path in SUPPLY_JSON_KEY / serviceAccountKeyPath and that the file is a JSON key",
          docs: ANDROID_DOCS,
        };
      }
    },
  },
];

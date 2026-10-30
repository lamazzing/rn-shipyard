import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ShipyardError } from "../utils/errors.js";
import { exec, NON_INTERACTIVE_ENV } from "../utils/shell.js";
import { SECRET_ENV_VARS } from "../utils/secrets.js";

export interface EasBuildProfile {
  distribution?: string;
  extends?: string;
  env?: Record<string, unknown>;
  ios?: Record<string, unknown>;
  android?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EasSubmitConfig {
  ios?: {
    appleId?: string;
    ascAppId?: string;
    appleTeamId?: string;
    [key: string]: unknown;
  };
  android?: {
    serviceAccountKeyPath?: string;
    track?: string;
    [key: string]: unknown;
  };
}

export interface EasConfig {
  build: Record<string, EasBuildProfile>;
  submit?: Record<string, EasSubmitConfig>;
}

export interface AppConfig {
  /** File the config came from: "app.json" or a dynamic config such as "app.config.js". */
  source: string;
  name: string;
  slug: string;
  version: string;
  /** version was not set in the config; Expo uses 1.0.0 */
  versionDefaulted?: boolean;
  ios?: {
    bundleIdentifier?: string;
    buildNumber?: string;
  };
  android?: {
    package?: string;
    versionCode?: number;
  };
}

export async function parseEasConfig(projectDir: string): Promise<EasConfig> {
  const easPath = join(projectDir, "eas.json");
  let raw: string;

  try {
    raw = await readFile(easPath, "utf-8");
  } catch {
    throw new ShipyardError(
      "MISSING_CONFIG_EAS",
      "eas.json not found in project directory",
      "Create an eas.json file or run 'eas build:configure' first"
    );
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.build) {
      throw new ShipyardError(
        "INVALID_EAS_CONFIG",
        "eas.json is missing the 'build' section",
        "Add a 'build' section with at least one profile to eas.json"
      );
    }
    return parsed as EasConfig;
  } catch (err) {
    if (err instanceof ShipyardError) throw err;
    throw new ShipyardError(
      "INVALID_EAS_CONFIG",
      "Failed to parse eas.json",
      "Check that eas.json contains valid JSON"
    );
  }
}

/** Dynamic Expo config files, in the order they are looked up. */
export const DYNAMIC_CONFIG_FILES = [
  "app.config.ts",
  "app.config.js",
  "app.config.mjs",
  "app.config.cjs",
] as const;

const EVAL_TIMEOUT_MS = 60_000;

/** Environment a build profile sets (`build.<profile>.env`), minus the names rn-shipyard owns. */
export interface ProfileEnv {
  env: Record<string, string>;
  /** Profile variables that were ignored because rn-shipyard sets them itself (signing secrets). */
  ignored: string[];
  /** Set, but they change how tools run: warn, do not drop. */
  risky: string[];
  /** Keys whose value is not a string, number or boolean (dropped). */
  invalid: string[];
}

const RISKY_ENV = ["PATH", "NODE_OPTIONS", "RUBYOPT", "GIT_SSH_COMMAND", "BUNDLE_GEMFILE"];
function isRiskyEnvName(name: string): boolean {
  return RISKY_ENV.includes(name) || name.startsWith("DYLD_");
}

/** One warning line per kind of problem found in a profile's env (empty when clean). */
export function profileEnvWarnings(r: ProfileEnv, profile: string): string[] {
  const out: string[] = [];
  if (r.ignored.length > 0)
    out.push(`Ignoring ${r.ignored.join(", ")} from eas.json build.${profile}.env: rn-shipyard sets these itself (signing secrets come from your environment; the non-interactive guard cannot be turned off)`);
  if (r.risky.length > 0)
    out.push(`eas.json build.${profile}.env sets ${r.risky.join(", ")}: these change how tools run; make sure that's intended`);
  if (r.invalid.length > 0)
    out.push(`Ignoring ${r.invalid.join(", ")} in eas.json build.${profile}.env: values must be strings (numbers and booleans are converted)`);
  return out;
}

/** Variables rn-shipyard sets itself: a build profile can never override them. */
export function isReservedEnvName(name: string): boolean {
  return (
    (SECRET_ENV_VARS as readonly string[]).includes(name) ||
    name === "MATCH_GIT_URL" ||
    name.startsWith("SHIPYARD_") ||
    // the git redirect to the local Match clone is built from these
    name === "GIT_CONFIG_COUNT" ||
    name === "GIT_CONFIG_PARAMETERS" ||
    name.startsWith("GIT_CONFIG_KEY_") ||
    name.startsWith("GIT_CONFIG_VALUE_") ||
    Object.prototype.hasOwnProperty.call(NON_INTERACTIVE_ENV, name) ||
    name.startsWith("ORG_GRADLE_PROJECT_android.injected.signing.")
  );
}

/**
 * Resolves `build.<profile>.env`, following `extends` chains (the child overrides the parent;
 * a cycle ends the chain). Pure: takes an already parsed eas.json.
 */
export function profileEnvFrom(easConfig: EasConfig | null | undefined, profile: string): ProfileEnv {
  const chain: EasBuildProfile[] = [];
  const seen = new Set<string>();
  let name: string | undefined = profile;
  while (name !== undefined && !seen.has(name)) {
    seen.add(name);
    const p: EasBuildProfile | undefined = easConfig?.build?.[name];
    if (!p || typeof p !== "object") break;
    chain.unshift(p);
    name = typeof p.extends === "string" ? p.extends : undefined;
  }
  const env: Record<string, string> = {};
  const ignored: string[] = [];
  const risky: string[] = [];
  const invalid: string[] = [];
  for (const p of chain) {
    if (!p.env || typeof p.env !== "object") continue;
    for (const [key, value] of Object.entries(p.env)) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        if (!invalid.includes(key)) invalid.push(key);
        continue;
      }
      if (isReservedEnvName(key)) {
        if (!ignored.includes(key)) ignored.push(key);
        continue;
      }
      if (isRiskyEnvName(key) && !risky.includes(key)) risky.push(key);
      env[key] = String(value);
    }
  }
  return { env, ignored, risky, invalid };
}

/** Reads `build.<profile>.env` from eas.json. No eas.json means no profile env. */
export async function readProfileEnv(projectDir: string, profile: string): Promise<ProfileEnv> {
  try {
    return profileEnvFrom(await parseEasConfig(projectDir), profile);
  } catch (err) {
    if (err instanceof ShipyardError && err.code === "MISSING_CONFIG_EAS") {
      return { env: {}, ignored: [], risky: [], invalid: [] };
    }
    throw err;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the Expo config the way EAS CLI does: a dynamic config (app.config.ts/js/mjs/cjs) is
 * evaluated with `npx expo config --json`, with the build profile's env applied (that is how
 * APP_VARIANT-style configs work); otherwise app.json is read. Never writes to any of them.
 */
export async function parseAppConfig(
  projectDir: string,
  profileEnv: Record<string, string> = {}
): Promise<AppConfig> {
  for (const file of DYNAMIC_CONFIG_FILES) {
    if (await exists(join(projectDir, file))) {
      return evaluateDynamicConfig(projectDir, file, profileEnv);
    }
  }

  const appJsonPath = join(projectDir, "app.json");
  let raw: string;
  try {
    raw = await readFile(appJsonPath, "utf-8");
  } catch {
    throw new ShipyardError(
      "MISSING_CONFIG_APP",
      "No app.json, app.config.js or app.config.ts found in project directory",
      "Create an app.json (or app.config.js / app.config.ts) with your Expo app configuration"
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ShipyardError(
      "INVALID_APP_CONFIG",
      `app.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      "Fix the syntax error in app.json"
    );
  }
  return extractAppConfig((parsed.expo ?? parsed) as Record<string, unknown>, "app.json");
}

async function evaluateDynamicConfig(
  projectDir: string,
  file: string,
  profileEnv: Record<string, string>
): Promise<AppConfig> {
  if (!(await exists(join(projectDir, "node_modules", "expo", "package.json")))) {
    throw new ShipyardError(
      "APP_CONFIG_EVAL_FAILED",
      `Cannot evaluate ${file}: the expo package is not installed in this project`,
      "npm install expo"
    );
  }
  const fix =
    "Run `npx expo config --json` in your project to see the error. Make sure dependencies are installed (`npm install`).";
  let result;
  try {
    // Unlike EAS (cloud builds have no .env), EXPO_NO_DOTENV is NOT set: we build locally, where
    // `expo prebuild` and Metro load .env, so the config we read must match what they see.
    result = await exec("npx", ["expo", "config", "--json"], {
      cwd: projectDir,
      env: profileEnv,
      timeout: EVAL_TIMEOUT_MS,
      stream: false,
    });
  } catch (err) {
    throw new ShipyardError(
      "APP_CONFIG_EVAL_FAILED",
      `Could not run \`npx expo config --json\` to evaluate ${file}: ${err instanceof Error ? err.message : String(err)}`,
      fix
    );
  }
  if (result.exitCode !== 0) {
    const tail = result.stderr.split("\n").slice(-20).join("\n").trim();
    throw new ShipyardError(
      "APP_CONFIG_EVAL_FAILED",
      `Evaluating ${file} with \`npx expo config --json\` failed (exit ${result.exitCode})${
        tail ? `:\n${tail}` : ` (no output; it may have timed out after ${EVAL_TIMEOUT_MS / 1000}s)`
      }`,
      fix
    );
  }
  const parsed = parseJsonLoose(result.stdout);
  if (!parsed || typeof parsed !== "object") {
    throw new ShipyardError(
      "APP_CONFIG_EVAL_FAILED",
      `\`npx expo config --json\` did not print a JSON config for ${file}`,
      fix
    );
  }
  const obj = parsed as Record<string, unknown>;
  return extractAppConfig((obj.expo ?? obj) as Record<string, unknown>, file);
}

/**
 * JSON.parse of the whole output; failing that, of each suffix starting at a line that begins
 * with "{" (some plugins print log lines first). Anything else fails closed (undefined).
 */
function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("{")) continue;
    try {
      return JSON.parse(lines.slice(i).join("\n"));
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function extractAppConfig(expo: Record<string, unknown>, source: string): AppConfig {
  if (!expo.name || !expo.slug) {
    const pre = source === "app.json" ? "expo." : "";
    throw new ShipyardError(
      "INVALID_APP_CONFIG",
      `${source} is missing required fields (name or slug)`,
      `Ensure ${source} defines ${pre}name and ${pre}slug`
    );
  }
  const versionDefaulted = !expo.version;

  const ios = expo.ios as Record<string, unknown> | undefined;
  const android = expo.android as Record<string, unknown> | undefined;

  return {
    source,
    name: String(expo.name),
    slug: String(expo.slug),
    version: versionDefaulted ? "1.0.0" : String(expo.version),
    ...(versionDefaulted ? { versionDefaulted: true } : {}),
    ios: ios
      ? {
          bundleIdentifier: ios.bundleIdentifier as string | undefined,
          buildNumber: ios.buildNumber as string | undefined,
        }
      : undefined,
    android: android
      ? {
          package: android.package as string | undefined,
          versionCode: android.versionCode as number | undefined,
        }
      : undefined,
  };
}

/**
 * "Add <field> to <your config>" text, EAS style. We never write to the user's config, so a
 * dynamic one (which cannot be edited programmatically at all) gets the snippet to paste.
 */
export function configFieldHint(source: string, path: string, example: string): string {
  const keys = path.split(".");
  const leaf = keys[keys.length - 1];
  if (source === "app.json") {
    const nested = keys.slice(0, -1).reduceRight<unknown>((acc, k) => ({ [k]: acc }), { [leaf]: example });
    return `Add \`${JSON.stringify({ expo: nested })}\` to app.json (rn-shipyard never edits it).`;
  }
  const snippet = keys
    .slice(0, -1)
    .reduceRight<string>((acc, k) => `${k}: { ${acc} }`, `${leaf}: ${JSON.stringify(example)}`);
  return `"${path}" is not defined in your ${source} and rn-shipyard can't update this file programmatically (it never edits your config). Add the value on your own, in the object your config returns (\`${snippet}\`), and run this command again.`;
}

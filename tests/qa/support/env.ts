import { spawn, spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Support code for the QA suite (tests/qa): the BUILT cli (dist/index.js) is run as a child
 * process, with real git, fastlane, Gradle and CocoaPods, against throwaway Expo projects.
 * Nothing here touches anything outside the per-run temp directory.
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const CLI = join(REPO_ROOT, "dist", "index.js");

/** Bundle id / package the fixture's app.json is given */
export const APP_ID = "com.shipyardqa.app";

export function runDir(): string {
  const dir = process.env.QA_RUN_DIR;
  if (!dir) throw new Error("QA_RUN_DIR is not set: run the suite with `npm run test:qa` (vitest.qa.config.ts sets it up)");
  return dir;
}

// ---------------------------------------------------------------------------------------------
// Tools on this host: scenarios skip with a clear message when one is missing
// ---------------------------------------------------------------------------------------------

export function has(cmd: string, args: string[] = ["--version"]): boolean {
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}

export function javaMajor(): number | undefined {
  const r = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (r.status !== 0) return undefined;
  const m = /version "(\d+)(?:\.(\d+))?/.exec(r.stderr + r.stdout);
  if (!m) return undefined;
  return m[1] === "1" ? Number(m[2]) : Number(m[1]);
}

export function androidSdk(): string | undefined {
  for (const c of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library", "Android", "sdk")]) {
    if (c && existsSync(join(c, "platforms"))) return c;
  }
  return undefined;
}

/** Why the Android build scenario cannot run here, or undefined when it can. */
export function androidSkipReason(): string | undefined {
  if (process.platform !== "darwin") return "not macOS";
  if (!has("fastlane")) return "fastlane is not installed";
  if (!has("keytool", ["-help"]) || !has("jarsigner", ["-help"])) return "no JDK (keytool/jarsigner)";
  if (!androidSdk()) return "no Android SDK (set ANDROID_HOME)";
  const major = javaMajor();
  if (major === undefined || major < 17) {
    return `JDK ${major ?? "?"} found, the Gradle build needs JDK 17 or newer (set JAVA_HOME)`;
  }
  return undefined;
}

/**
 * Locally a missing tool skips the scenario. In CI (CI set, not "0"/"false") a missing tool is a
 * broken job image, so it fails the file instead of quietly skipping coverage.
 */
export function requireOrSkip(reason: string | undefined): string | undefined {
  const ci = process.env.CI;
  if (reason && ci && ci !== "0" && ci.toLowerCase() !== "false") {
    throw new Error(`QA scenario cannot run in CI: ${reason}`);
  }
  return reason;
}

/** Why the iOS scenarios cannot run here, or undefined when they can. */
export function iosSkipReason(): string | undefined {
  if (process.platform !== "darwin") return "not macOS";
  if (!has("fastlane")) return "fastlane is not installed";
  if (!has("xcodebuild", ["-version"])) return "Xcode is not installed";
  if (!has("pod")) return "CocoaPods is not installed";
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Running the CLI
// ---------------------------------------------------------------------------------------------

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr in arrival order is not kept; this is the two joined */
  all: string;
}

/** Variables that would change what rn-shipyard does: never inherited from the host. */
const SCRUB = /^(MATCH_|FASTLANE_|APP_STORE_CONNECT_|EXPO_ASC_|EXPO_APPLE_|APPLE_|SUPPLY_|ANDROID_KEYSTORE|ANDROID_KEY_|NO_COLOR$|FORCE_COLOR$|CI$|GITHUB_ACTIONS$|NODE_OPTIONS$)/;

export function cleanEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!SCRUB.test(k)) env[k] = v;
  Object.assign(env, {
    FASTLANE_SKIP_UPDATE_CHECK: "1",
    FASTLANE_OPT_OUT_USAGE: "1",
    FASTLANE_HIDE_TIMESTAMP: "1",
    CP_HOME_DIR: process.env.CP_HOME_DIR ?? "",
  });
  if (!env.CP_HOME_DIR) delete env.CP_HOME_DIR;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export interface RunOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Run `bin args` instead of the rn-shipyard CLI */
  bin?: string;
}

/** Runs a process with stdin closed and stdout/stderr piped (so: not a terminal). */
export function run(bin: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: cleanEnv(opts.env), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${opts.timeoutMs ?? 120_000}ms: ${bin} ${args.join(" ")}\n${stdout}\n${stderr}`));
    }, opts.timeoutMs ?? 120_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr, all: stdout + stderr });
    });
  });
}

export function cli(args: string[], opts: RunOptions): Promise<RunResult> {
  return run(process.execPath, [CLI, ...args], opts);
}

/** Parses stdout as exactly one JSON document; throws with the raw text otherwise. */
export function parseJson(r: RunResult): Record<string, any> {
  try {
    const v = JSON.parse(r.stdout);
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch (e) {
    throw new Error(`stdout is not one JSON document (${(e as Error).message}); exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  }
}

// eslint-disable-next-line no-control-regex
export const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]|\u001b\][^\u0007]*\u0007/;

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

export type Layout = "root" | "subfolder" | "nogit";

export interface Project {
  layout: Layout;
  /** The git repository root (== dir for "root"; the parent of dir for "subfolder"; == dir for "nogit") */
  repo: string;
  /** Where the Expo app lives: the cwd for every CLI call */
  dir: string;
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

/** An empty local bare repository: stands in for the Match certificates repo (no network, no Apple). */
export async function makeBareRepo(name: string): Promise<string> {
  const dir = join(runDir(), "remotes", `${name}.git`);
  await mkdir(dir, { recursive: true });
  git(dir, ["init", "-q", "--bare", "-b", "main"]);
  return dir;
}

let counter = 0;

/**
 * A fresh copy of the run's fixture app (node_modules symlinked, which is enough for init / doctor /
 * history; native scenarios use `copyFixtureWithModules`). `commit` makes the repo's first commit.
 */
export async function makeProject(layout: Layout, label: string): Promise<Project> {
  const base = join(runDir(), "projects", `${String(++counter).padStart(2, "0")}-${label}`);
  const repo = base;
  const dir = layout === "subfolder" ? join(base, "app") : base;
  await mkdir(dir, { recursive: true });
  await cp(join(runDir(), "fixture"), dir, { recursive: true, filter: (src) => !/[\\/]node_modules$/.test(src) });
  await symlink(join(runDir(), "fixture", "node_modules"), join(dir, "node_modules"));
  await writeFile(join(dir, ".gitignore"), "node_modules\n.expo/\ndist/\n");
  if (layout !== "nogit") {
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["-c", "user.email=qa@example.invalid", "-c", "user.name=qa", "add", "-A"]);
    git(repo, ["-c", "user.email=qa@example.invalid", "-c", "user.name=qa", "commit", "-q", "-m", "fixture"]);
  }
  return { layout, repo, dir };
}

/** Same as makeProject("root") but with a real (copied) node_modules: for prebuild / Gradle / pods. */
export async function makeNativeProject(label: string): Promise<Project> {
  const dir = join(runDir(), "native", label);
  await mkdir(dirname(dir), { recursive: true });
  // `cp -c` clones on APFS (instant); fall back to a normal copy elsewhere
  const clone = spawnSync("cp", ["-cR", join(runDir(), "fixture"), dir]);
  if (clone.status !== 0) await cp(join(runDir(), "fixture"), dir, { recursive: true });
  return { layout: "nogit", repo: dir, dir };
}

export async function readJson<T = any>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** A throwaway Android keystore (keytool) + the credentials JSON `init --android-credentials` reads. */
export async function makeKeystore(dir: string): Promise<{ keystore: string; credentials: string; password: string; alias: string }> {
  await mkdir(dir, { recursive: true });
  const keystore = join(dir, "qa-upload.jks");
  const password = "qa-throwaway-pass-1";
  const alias = "qaupload";
  const r = spawnSync(
    "keytool",
    ["-genkeypair", "-keystore", keystore, "-storetype", "PKCS12", "-alias", alias, "-keyalg", "RSA", "-keysize", "2048", "-validity", "3650", "-storepass", password, "-keypass", password, "-dname", "CN=QA Throwaway, O=rn-shipyard QA, C=US"],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error(`keytool failed: ${r.stderr}${r.stdout}`);
  const credentials = join(dir, "qa-credentials.json");
  await writeFile(credentials, JSON.stringify({ keystorePassword: password, keyAlias: alias, keyPassword: password }));
  return { keystore, credentials, password, alias };
}

// ---------------------------------------------------------------------------------------------
// fastlane PATH shim: records every call of selected lanes, passes everything else to the real one
// ---------------------------------------------------------------------------------------------

export interface ShimCall {
  args: string[];
  env: Record<string, string>;
}

export interface FastlaneShim {
  /** Directory to put in front of PATH */
  binDir: string;
  logFile: string;
  /** env for `cli(...)`: PATH in front, the log location */
  env: Record<string, string>;
  calls(): Promise<ShimCall[]>;
}

/** Env vars the shim logs (names only matter for credentials; every value in QA is fake). */
const LOGGED = /^(APP_STORE_CONNECT_|FASTLANE_USER|FASTLANE_PASSWORD|MATCH_|EXPO_ASC_|FASTLANE_TEAM_ID)/;

/**
 * `fastlane` shim. Calls for a lane in `intercept` are logged and answered with `exitCode`;
 * every other call (`--version`, other lanes) runs the real fastlane.
 */
export async function makeFastlaneShim(name: string, intercept: string[], exitCode = 0): Promise<FastlaneShim> {
  const real = spawnSync("which", ["fastlane"], { encoding: "utf8" }).stdout.trim();
  const binDir = join(runDir(), "shims", name);
  await mkdir(binDir, { recursive: true });
  const logFile = join(binDir, "calls.log");
  const script = `#!/bin/bash
for lane in ${intercept.map((l) => `"${l}"`).join(" ")}; do
  if [ "$2" = "$lane" ]; then
    {
      echo "CALL"
      for a in "$@"; do echo "ARG $a"; done
      env | grep -E '${LOGGED.source}' | sed 's/^/ENV /'
    } >> "${logFile}"
    exit ${exitCode}
  fi
done
exec "${real}" "$@"
`;
  await writeFile(join(binDir, "fastlane"), script);
  await chmod(join(binDir, "fastlane"), 0o755);
  await writeFile(logFile, "");
  return {
    binDir,
    logFile,
    env: { PATH: `${binDir}:${process.env.PATH}` },
    async calls() {
      const text = await readFile(logFile, "utf8");
      return text
        .split("CALL\n")
        .filter(Boolean)
        .map((block) => {
          const args: string[] = [];
          const env: Record<string, string> = {};
          for (const line of block.split("\n")) {
            if (line.startsWith("ARG ")) args.push(line.slice(4));
            else if (line.startsWith("ENV ")) {
              const i = line.indexOf("=");
              env[line.slice(4, i)] = line.slice(i + 1);
            }
          }
          return { args, env };
        });
    },
  };
}

export async function cleanup(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export { tmpdir };

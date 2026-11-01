#!/usr/bin/env node
// Real Apple end-to-end QA: the BUILT cli (dist/index.js) against a throwaway Expo app with a real
// App Store Connect API key, a real Match repo and a real TestFlight upload. Run by the `apple` job in
// .github/workflows/qa.yml (environment apple-qa); see CONTRIBUTING.md, "QA suite".
//
// What it proves: `init --platform ios --non-interactive` signs in to Apple with ONLY the API key
// (no FASTLANE_USER, no Apple ID), then `build` and `submit` work with it.
//
// Usage: node scripts/qa-apple.mjs [--dry-run] [--out <dir>]
//   --dry-run  create the fixture, print the plan and the environment check, stop before contacting Apple
//              (no network except create-expo-app / npm when QA_FIXTURE_DIR is not given)
//
// Environment (the workflow sets these; names only here, never values):
//   ASC_KEY_PATH       path of the App Store Connect .p8 file (mode 600, outside the checkout)
//   ASC_KEY_ID  ASC_ISSUER_ID  APPLE_TEAM_ID  QA_BUNDLE_ID  MATCH_GIT_URL  MATCH_PASSWORD
//   MATCH_KEYCHAIN_PASSWORD  optional: password of the temp keychain (only used to redact it)
//   QA_FIXTURE_DIR     optional prepared Expo project to copy instead of running create-expo-app
//
// First run: the Match repo is empty, so init's Match step (readonly: false) creates the
// distribution certificate and the App Store profile and pushes them. Later runs reuse them.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO_ROOT, "dist", "index.js");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const OUT = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : "qa-apple-out");
const REQUIRED = ["ASC_KEY_PATH", "ASC_KEY_ID", "ASC_ISSUER_ID", "APPLE_TEAM_ID", "QA_BUNDLE_ID", "MATCH_GIT_URL", "MATCH_PASSWORD"];
const env = (k) => process.env[k] ?? "";

// --- redaction: nothing the job prints or saves may contain the password or the key ---
const secrets = new Set();
function addSecret(v) {
  if (v && v.length >= 4) secrets.add(v);
}
addSecret(env("MATCH_PASSWORD"));
addSecret(env("MATCH_KEYCHAIN_PASSWORD"));
if (env("ASC_KEY_PATH") && existsSync(env("ASC_KEY_PATH"))) {
  const pem = readFileSync(env("ASC_KEY_PATH"), "utf8");
  addSecret(pem.trim());
  for (const line of pem.split(/\r?\n/)) if (line.length > 20 && !line.startsWith("-----")) addSecret(line.trim());
  addSecret(Buffer.from(pem).toString("base64"));
}
function redact(text) {
  let out = text;
  for (const s of secrets) out = out.split(s).join("***");
  return out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "***");
}

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
}

/** The environment the CLI gets: only an API key. No FASTLANE_USER / EXPO_APPLE_* / password variables. */
function cliEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) {
    if (/^(FASTLANE_USER|FASTLANE_PASSWORD|FASTLANE_APPLE_|EXPO_APPLE_|APP_STORE_CONNECT_|EXPO_ASC_|MATCH_PASSWORD$|MATCH_GIT_URL$|APPLE_TEAM_ID$)/.test(k)) delete e[k];
  }
  delete e.ASC_KEY_PATH; // the CLI reads the EXPO_ASC_* names below
  Object.assign(e, {
    EXPO_ASC_API_KEY_PATH: env("ASC_KEY_PATH"),
    EXPO_ASC_KEY_ID: env("ASC_KEY_ID"),
    EXPO_ASC_ISSUER_ID: env("ASC_ISSUER_ID"),
    APPLE_TEAM_ID: env("APPLE_TEAM_ID"),
    MATCH_GIT_URL: env("MATCH_GIT_URL"),
    MATCH_PASSWORD: env("MATCH_PASSWORD"),
    FASTLANE_SKIP_UPDATE_CHECK: "1",
    FASTLANE_OPT_OUT_USAGE: "1",
    FASTLANE_HIDE_TIMESTAMP: "1",
    NO_COLOR: "1",
  });
  return e;
}

/** Runs the cli, saves redacted stdout / stderr under OUT, echoes stderr (progress) redacted. */
function runCli(name, cliArgs, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [CLI, ...cliArgs], { cwd, env: cliEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => {
      const s = d.toString("utf8");
      stderr += s;
      process.stderr.write(redact(s));
    });
    child.on("close", async (code) => {
      await writeFile(join(OUT, `${name}.stdout.json`), redact(stdout));
      await writeFile(join(OUT, `${name}.stderr.log`), redact(stderr));
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        // not one JSON document: the checks below fail on it
      }
      resolveRun({ code: code ?? -1, json });
    });
  });
}

async function makeFixture() {
  const dir = join(OUT, "app");
  await rm(dir, { recursive: true, force: true });
  if (env("QA_FIXTURE_DIR")) {
    await cp(env("QA_FIXTURE_DIR"), dir, { recursive: true });
  } else {
    const r = spawnSync("npx", ["--yes", "create-expo-app@latest", "app", "--template", "blank-typescript", "--no-install"], {
      cwd: OUT,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
      timeout: 300_000,
    });
    if (r.status !== 0 || !existsSync(join(dir, "app.json"))) throw new Error(`create-expo-app failed (${r.status}): ${r.stdout}\n${r.stderr}`);
  }
  await rm(join(dir, ".git"), { recursive: true, force: true });
  // The fixture's OWN app.json only: the QA bundle id and no export-compliance question for TestFlight.
  const appJsonPath = join(dir, "app.json");
  const app = JSON.parse(await readFile(appJsonPath, "utf8"));
  app.expo.name = "QA App";
  app.expo.slug = "qa-app";
  app.expo.ios = {
    ...app.expo.ios,
    bundleIdentifier: env("QA_BUNDLE_ID") || "io.github.lamazzing.rnshipyard.qa",
    infoPlist: { ...app.expo.ios?.infoPlist, ITSAppUsesNonExemptEncryption: false },
  };
  await writeFile(appJsonPath, JSON.stringify(app, null, 2) + "\n");
  // build / submit read eas.json (rn-shipyard never writes it)
  if (!existsSync(join(dir, "eas.json"))) {
    const eas = { cli: { version: ">= 16.0.0" }, build: { production: { distribution: "store" } }, submit: { production: {} } };
    await writeFile(join(dir, "eas.json"), JSON.stringify(eas, null, 2) + "\n");
  }
  await writeFile(join(dir, ".gitignore"), "node_modules\n.expo/\ndist/\nios/\nandroid/\n");
  if (!existsSync(join(dir, "node_modules", "expo"))) {
    const i = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8", timeout: 600_000 });
    if (i.status !== 0) throw new Error(`npm install in the fixture failed: ${i.stderr}`);
  }
  // app at the repository root
  const git = (...a) => spawnSync("git", ["-c", "user.email=qa@example.invalid", "-c", "user.name=qa", ...a], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  const c = git("commit", "-q", "-m", "fixture");
  if (c.status !== 0) throw new Error(`git commit failed: ${c.stderr}`);
  return dir;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (!existsSync(CLI)) throw new Error(`${CLI} not found: run \`npm run build\` first`);
  const missing = REQUIRED.filter((k) => !env(k));
  if (missing.length) {
    if (!DRY) {
      console.error(`Missing environment: ${missing.join(", ")}`);
      process.exitCode = 2;
      return;
    }
    console.log(`(dry run) not set here: ${missing.join(", ")}`);
  }

  const dir = await makeFixture();
  const plan = [
    ["init", ["init", "--platform", "ios", "--non-interactive", "--json"]],
    ["build", ["build", "--platform", "ios", "--non-interactive", "--json"]],
    ["submit", ["submit", "--platform", "ios", "--non-interactive", "--json"]],
  ];
  const childEnv = cliEnv();
  console.log(`fixture: ${dir}`);
  console.log(`CLI env (names only): ${Object.keys(childEnv).filter((k) => /^(EXPO_ASC_|MATCH_|APPLE_|FASTLANE_)/.test(k)).sort().join(" ")}`);
  check(!childEnv.FASTLANE_USER && !childEnv.FASTLANE_PASSWORD, "the CLI gets no Apple ID (API key only)");
  for (const [name, a] of plan) console.log(`plan: ${name}: rn-shipyard ${a.join(" ")}`);
  if (DRY) {
    console.log("dry run: stopping before contacting Apple");
    return;
  }

  const init = await runCli("init", plan[0][1], dir);
  check(init.code === 0, `init exits 0 (got ${init.code})`);
  check(init.json?.success === true, "init reports success: true");
  check(init.json?.setup?.ios?.status === "configured", `init setup.ios.status is "configured" (got ${init.json?.setup?.ios?.status})`);
  check(init.json?.setup?.ios?.matchAuth === "api-key", `init setup.ios.matchAuth is "api-key" (got ${init.json?.setup?.ios?.matchAuth})`);
  if (init.json?.error) console.log(`init error: ${redact(`${init.json.error.code}: ${init.json.error.message}`)}`);
  if (failures.length) return;

  const build = await runCli("build", plan[1][1], dir);
  const bi = build.json?.platforms?.ios;
  check(build.code === 0 && build.json?.success === true, `build succeeds (exit ${build.code})`);
  check(bi?.status === "success", `build platforms.ios.status is "success" (got ${bi?.status})`);
  const ipa = bi?.artifactPath ? resolve(dir, bi.artifactPath) : "";
  check(!!ipa && ipa.endsWith(".ipa") && existsSync(ipa), `build produced an .ipa (${bi?.artifactPath})`);
  if (bi?.error) console.log(`build error: ${redact(String(bi.error))}`);
  if (failures.length) return;

  const submit = await runCli("submit", plan[2][1], dir);
  const si = submit.json?.platforms?.ios;
  check(submit.code === 0 && submit.json?.success === true, `submit succeeds (exit ${submit.code})`);
  check(si?.status === "success", `submit platforms.ios.status is "success" (got ${si?.status})`);

  console.log(`\nSummary: signing ${init.json?.setup?.ios?.status} (${init.json?.setup?.ios?.matchAuth}), build ${bi?.version} (${bi?.buildNumber}), TestFlight upload ${si?.status}`);
}

main()
  .catch((e) => {
    console.error(redact(String(e?.stack ?? e)));
    failures.push("script error");
  })
  .finally(() => {
    if (failures.length) {
      console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    }
  });

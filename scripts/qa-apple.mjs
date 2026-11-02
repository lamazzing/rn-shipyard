#!/usr/bin/env node
// Real Apple end-to-end QA: the BUILT cli (dist/index.js) against a throwaway Expo app with a real
// App Store Connect API key, a real Match repo and a real TestFlight upload. Run by the `apple` job in
// .github/workflows/qa.yml (environment apple-qa); see CONTRIBUTING.md, "QA suite".
//
// What it proves: `init --platform ios --non-interactive` signs in to Apple with ONLY the API key
// (no FASTLANE_USER, no Apple ID), then `build` and `submit` work with it.
//
// Usage: node scripts/qa-apple.mjs [--stage fixture|init|build|submit|all] [--dry-run] [--out <dir>]
//   --stage    one stage per workflow step, so each step gets only the secrets it needs:
//                fixture  create + install the Expo app. NO secrets may exist (refuses to run otherwise):
//                         create-expo-app and npm install execute third-party code
//                init     Match + signing (key, Match password, ssh-agent, keychain)
//                build    gym (same as init)
//                submit   TestFlight upload (key only)
//              each stage reads the previous stage's JSON from the out dir. Default: all (local use).
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
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO_ROOT, "dist", "index.js");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const STAGE = args.includes("--stage") ? args[args.indexOf("--stage") + 1] : "all";
if (!["fixture", "init", "build", "submit", "all"].includes(STAGE)) {
  console.error(`unknown --stage ${STAGE}`);
  process.exit(2);
}
// Pinned: the nightly must not resolve @latest while secrets are around. Drift against new Expo
// releases is caught by the secret-free `qa` job.
const CREATE_EXPO_APP = "create-expo-app@5.0.0";
const EXPO_TEMPLATE = "blank-typescript@58.0.31";
/** Variables that mean "secrets are present": fixture creation refuses to run with any of them. */
const SECRET_VARS = ["ASC_KEY_P8", "ASC_KEY_PATH", "MATCH_PASSWORD", "MATCH_DEPLOY_KEY", "MATCH_KEYCHAIN_PASSWORD", "SSH_AUTH_SOCK"];
const OUT = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : "qa-apple-out");
const REQUIRED_ALL = ["ASC_KEY_PATH", "ASC_KEY_ID", "ASC_ISSUER_ID", "APPLE_TEAM_ID", "QA_BUNDLE_ID", "MATCH_GIT_URL", "MATCH_PASSWORD"];
const REQUIRED_SUBMIT = ["ASC_KEY_PATH", "ASC_KEY_ID", "ASC_ISSUER_ID"];
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
function cliEnv(stage = "init") {
  const e = { ...process.env };
  for (const k of Object.keys(e)) {
    if (/^(FASTLANE_USER|FASTLANE_PASSWORD|FASTLANE_APPLE_|EXPO_APPLE_|APP_STORE_CONNECT_|EXPO_ASC_|MATCH_PASSWORD$|MATCH_GIT_URL$|APPLE_TEAM_ID$)/.test(k)) delete e[k];
  }
  delete e.ASC_KEY_PATH; // the CLI reads the EXPO_ASC_* names below
  Object.assign(e, {
    EXPO_ASC_API_KEY_PATH: env("ASC_KEY_PATH"),
    EXPO_ASC_KEY_ID: env("ASC_KEY_ID"),
    EXPO_ASC_ISSUER_ID: env("ASC_ISSUER_ID"),
    FASTLANE_SKIP_UPDATE_CHECK: "1",
    FASTLANE_OPT_OUT_USAGE: "1",
    FASTLANE_HIDE_TIMESTAMP: "1",
    NO_COLOR: "1",
  });
  if (stage !== "submit") {
    Object.assign(e, { APPLE_TEAM_ID: env("APPLE_TEAM_ID"), MATCH_GIT_URL: env("MATCH_GIT_URL"), MATCH_PASSWORD: env("MATCH_PASSWORD") });
  } else {
    // submit uploads with the key alone: no Match password, no Match repo, no ssh-agent, no keychain
    delete e.SSH_AUTH_SOCK;
    delete e.MATCH_KEYCHAIN_NAME;
    delete e.MATCH_KEYCHAIN_PASSWORD;
  }
  return e;
}

/** Runs the cli, saves redacted stdout / stderr under OUT, echoes stderr (progress) redacted. */
function runCli(name, cliArgs, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [CLI, ...cliArgs], { cwd, env: cliEnv(name), stdio: ["ignore", "pipe", "pipe"] });
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

/** A minimal environment for npm / create-expo-app: nothing from the job beyond what a package manager needs. */
function bareEnv() {
  const keep = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "SHELL"];
  const e = { CI: "1", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false" };
  for (const k of keep) if (process.env[k]) e[k] = process.env[k];
  return e;
}

async function makeFixture() {
  const present = SECRET_VARS.filter((k) => process.env[k]);
  const dir = join(OUT, "app");
  await rm(dir, { recursive: true, force: true });
  if (env("QA_FIXTURE_DIR")) {
    await cp(env("QA_FIXTURE_DIR"), dir, { recursive: true });
  } else {
    if (present.length) throw new Error(`refusing to run create-expo-app with secrets in the environment: ${present.join(", ")}`);
    const r = spawnSync("npx", ["--yes", CREATE_EXPO_APP, "app", "--template", EXPO_TEMPLATE, "--no-install"], {
      cwd: OUT,
      encoding: "utf8",
      env: bareEnv(),
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
    if (present.length) throw new Error(`refusing to run npm install with secrets in the environment: ${present.join(", ")}`);
    // lifecycle scripts off: third-party code must not run next to the key
    const i = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8", timeout: 600_000, env: bareEnv() });
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

async function previous(name) {
  try {
    return JSON.parse(await readFile(join(OUT, `${name}.stdout.json`), "utf8"));
  } catch {
    return undefined;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const dir = join(OUT, "app");
  if (STAGE === "fixture") {
    await makeFixture();
    console.log(`fixture ready: ${dir}`);
    return;
  }
  if (!existsSync(CLI)) throw new Error(`${CLI} not found: run \`npm run build\` first`);
  const required = STAGE === "submit" ? REQUIRED_SUBMIT : REQUIRED_ALL;
  const missing = required.filter((k) => !env(k));
  if (missing.length) {
    if (!DRY) {
      console.error(`Missing environment: ${missing.join(", ")}`);
      process.exitCode = 2;
      return;
    }
    console.log(`(dry run) not set here: ${missing.join(", ")}`);
  }
  if (STAGE === "all") await makeFixture();
  else if (!existsSync(join(dir, "app.json"))) throw new Error(`no fixture in ${dir}: run --stage fixture first`);

  const plan = [
    ["init", ["init", "--platform", "ios", "--non-interactive", "--json"]],
    ["build", ["build", "--platform", "ios", "--non-interactive", "--json"]],
    ["submit", ["submit", "--platform", "ios", "--non-interactive", "--json"]],
  ];
  const stages = STAGE === "all" ? ["init", "build", "submit"] : [STAGE];
  console.log(`fixture: ${dir}`);
  for (const st of stages) {
    const childEnv = cliEnv(st);
    console.log(`${st} env (names only): ${Object.keys(childEnv).filter((k) => /^(EXPO_ASC_|MATCH_|APPLE_|FASTLANE_|SSH_)/.test(k)).sort().join(" ")}`);
    check(!childEnv.FASTLANE_USER && !childEnv.FASTLANE_PASSWORD, `${st}: the CLI gets no Apple ID (API key only)`);
    console.log(`plan: ${st}: rn-shipyard ${plan.find((p) => p[0] === st)[1].join(" ")}`);
  }
  if (DRY) {
    console.log("dry run: stopping before contacting Apple");
    return;
  }

  if (stages.includes("init")) {
    const init = await runCli("init", plan[0][1], dir);
    check(init.code === 0, `init exits 0 (got ${init.code})`);
    check(init.json?.success === true, "init reports success: true");
    check(init.json?.setup?.ios?.status === "configured", `init setup.ios.status is "configured" (got ${init.json?.setup?.ios?.status})`);
    // matchAuth is computed from the environment BEFORE match runs (src/commands/init.ts, where ascKeyEnv is
    // picked), so on its own it does not prove the lane used the key. The real proof is that every Apple ID
    // variable is scrubbed from the CLI's environment (checked above): a lane that ignored the key would
    // fail with "Missing username" and the status could not be "configured".
    check(init.json?.setup?.ios?.matchAuth === "api-key", `init setup.ios.matchAuth is "api-key" (got ${init.json?.setup?.ios?.matchAuth})`);
    if (init.json?.error) console.log(`init error: ${redact(`${init.json.error.code}: ${init.json.error.message}`)}`);
    if (failures.length) return;
    console.log(`Summary: signing ${init.json.setup.ios.status} (${init.json.setup.ios.matchAuth})`);
  }

  if (stages.includes("build")) {
    if (STAGE === "build" && (await previous("init"))?.setup?.ios?.status !== "configured") throw new Error("init.stdout.json missing or not configured: run --stage init first");
    const build = await runCli("build", plan[1][1], dir);
    const bi = build.json?.platforms?.ios;
    check(build.code === 0 && build.json?.success === true, `build succeeds (exit ${build.code})`);
    check(bi?.status === "success", `build platforms.ios.status is "success" (got ${bi?.status})`);
    const ipa = bi?.artifactPath ? resolve(dir, bi.artifactPath) : "";
    check(!!ipa && ipa.endsWith(".ipa") && existsSync(ipa), `build produced an .ipa (${bi?.artifactPath})`);
    if (bi?.error) console.log(`build error: ${redact(String(bi.error))}`);
    if (failures.length) {
      // the CLI's error is a summary; gym keeps the whole xcodebuild log (uploaded, redacted)
      const gymLogs = join(process.env.HOME ?? "", "Library", "Logs", "gym");
      for (const f of existsSync(gymLogs) ? await readdir(gymLogs) : []) {
        if (f.endsWith(".log")) await writeFile(join(OUT, `gym-${f}`), redact(await readFile(join(gymLogs, f), "utf8")));
      }
      return;
    }
    console.log(`Summary: build ${bi.version} (${bi.buildNumber}) -> ${bi.artifactPath}`);
  }

  if (stages.includes("submit")) {
    if (STAGE === "submit" && (await previous("build"))?.platforms?.ios?.status !== "success") throw new Error("build.stdout.json missing or not successful: run --stage build first");
    const submit = await runCli("submit", plan[2][1], dir);
    const si = submit.json?.platforms?.ios;
    check(submit.code === 0 && submit.json?.success === true, `submit succeeds (exit ${submit.code})`);
    check(si?.status === "success", `submit platforms.ios.status is "success" (got ${si?.status})`);
    if (!failures.length) console.log(`Summary: TestFlight upload ${si?.status}`);
  }
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

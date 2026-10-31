import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_ID, CLI } from "./env.js";

/**
 * Once per run: builds nothing (npm run test:qa does that) but checks dist/ exists, then creates
 * the fixture Expo app every scenario copies:
 *   - QA_FIXTURE_DIR=<prepared project>  copy of it (local runs; npm install only if node_modules is missing)
 *   - otherwise                          `npx create-expo-app@latest --template blank-typescript`
 * Then app.json gets a bundle id / package. Everything lives under one temp dir (QA_RUN_DIR);
 * it is removed afterwards unless QA_KEEP=1.
 */
export default async function setup(): Promise<() => Promise<void>> {
  if (!existsSync(CLI)) throw new Error(`${CLI} not found: run \`npm run build\` first (npm run test:qa does)`);

  const run = process.env.QA_RUN_DIR_BASE
    ? await mkdtemp(join(process.env.QA_RUN_DIR_BASE, "shipyard-qa-"))
    : await mkdtemp(join(tmpdir(), "shipyard-qa-"));
  process.env.QA_RUN_DIR = run;
  try {
    await prepareFixture(run);
  } catch (err) {
    // vitest does not call the teardown when setup throws: do not leak the temp dir
    await rm(run, { recursive: true, force: true });
    throw err;
  }

  return async () => {
    if (process.env.QA_KEEP === "1") {
      // eslint-disable-next-line no-console
      console.log(`[qa] kept ${run}`);
      return;
    }
    await rm(run, { recursive: true, force: true });
  };
}

async function prepareFixture(run: string): Promise<void> {
  const fixture = join(run, "fixture");
  const started = Date.now();

  if (process.env.QA_FIXTURE_DIR) {
    await cp(process.env.QA_FIXTURE_DIR, fixture, { recursive: true });
  } else {
    await mkdir(run, { recursive: true });
    const r = spawnSync("npx", ["--yes", "create-expo-app@latest", "fixture", "--template", "blank-typescript", "--no-install"], {
      cwd: run,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
      timeout: 300_000,
    });
    if (r.status !== 0 || !existsSync(join(fixture, "app.json"))) {
      throw new Error(`create-expo-app failed (${r.status}): ${r.stdout}\n${r.stderr}`);
    }
  }

  // create-expo-app initialises a repository; every scenario decides for itself whether there is one
  await rm(join(fixture, ".git"), { recursive: true, force: true });

  // bundle id / package, in the COPY only
  const appJsonPath = join(fixture, "app.json");
  const app = JSON.parse(await readFile(appJsonPath, "utf8"));
  app.expo.name = "QA App";
  app.expo.slug = "qa-app";
  app.expo.ios = { ...app.expo.ios, bundleIdentifier: APP_ID };
  app.expo.android = { ...app.expo.android, package: APP_ID };
  await writeFile(appJsonPath, JSON.stringify(app, null, 2) + "\n");

  // the project is "migrating from EAS": build/submit read eas.json (rn-shipyard never writes it)
  if (!existsSync(join(fixture, "eas.json"))) {
    const eas = {
      cli: { version: ">= 16.0.0" },
      build: { production: { distribution: "store", android: { buildType: "app-bundle" } } },
      submit: { production: {} },
    };
    await writeFile(join(fixture, "eas.json"), JSON.stringify(eas, null, 2) + "\n");
  }

  if (!existsSync(join(fixture, "node_modules", "expo"))) {
    const i = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: fixture, encoding: "utf8", timeout: 600_000 });
    if (i.status !== 0) throw new Error(`npm install in the fixture failed: ${i.stderr}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[qa] fixture ready in ${Math.round((Date.now() - started) / 1000)}s (${run})`);
}

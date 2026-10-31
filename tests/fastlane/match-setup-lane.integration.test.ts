import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { generateFastfile } from "../../src/fastlane/generator.js";
import type { ShipyardConfig } from "../../src/core/config.js";

/**
 * REAL fastlane: the shipyard_match_setup lane must parse and take the App Store Connect key from
 * the environment (relative key paths are expanded against the project root, not fastlane/).
 * It never reaches Apple or a Match repo: the git URL is a path that does not exist, so match
 * stops at the clone. Skipped when fastlane is not installed.
 */
const hasFastlane = spawnSync("fastlane", ["--version"], { encoding: "utf-8" }).status === 0;

const config: ShipyardConfig = {
  version: "1.0.0",
  createdAt: "x",
  outputDir: "./output",
  platforms: { ios: { enabled: true, signingMethod: "match", matchGitUrl: "g", matchType: "appstore", teamId: "ABCDE12345", bundleId: "com.example.app" } },
};

describe.skipIf(!hasFastlane)("shipyard_match_setup with real fastlane", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "shipyard-matchlane-"));
    await generateFastfile(dir, config, "App");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    await writeFile(join(dir, "key.p8"), privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const lane = (extraEnv: Record<string, string>) =>
    spawnSync("fastlane", ["ios", "shipyard_match_setup"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 110_000,
      env: {
        ...process.env,
        FASTLANE_SKIP_UPDATE_CHECK: "1",
        FASTLANE_HIDE_TIMESTAMP: "1",
        FASTLANE_OPT_OUT_USAGE: "1",
        CI: "1",
        MATCH_GIT_URL: join(dir, "no-such-repo.git"),
        MATCH_PASSWORD: "x",
        FASTLANE_TEAM_ID: "ABCDE12345",
        ...extraEnv,
      },
    });

  it("is listed and parses", () => {
    const r = spawnSync("fastlane", ["lanes", "--json"], { cwd: dir, encoding: "utf-8", env: { ...process.env, FASTLANE_SKIP_UPDATE_CHECK: "1", FASTLANE_OPT_OUT_USAGE: "1", CI: "1" } });
    expect(r.stdout + r.stderr).toContain("shipyard_match_setup");
  }, 120_000);

  it("with a key (relative path) it signs in with the key instead of asking for an Apple ID", () => {
    const r = lane({
      APP_STORE_CONNECT_API_KEY_KEY_ID: "KEYID12345",
      APP_STORE_CONNECT_API_KEY_ISSUER_ID: "69a6de70-0000-0000-0000-000000000000",
      APP_STORE_CONNECT_API_KEY_KEY_FILEPATH: "key.p8",
    });
    const out = r.stdout + r.stderr;
    expect(out).toContain("SHIPYARD_MATCH_AUTH=api_key");
    expect(out).toMatch(/\| api_key\s+\| API_KEY_REDACTED/); // match received the key (its parameter summary redacts it)
    expect(out).not.toMatch(/Missing username|Apple ID/i);
    expect(out).not.toMatch(/No such file|ENOENT.*key\.p8/);
  }, 120_000);

  it("without a key it falls back to the Apple ID path", () => {
    const r = lane({});
    expect(r.stdout + r.stderr).toContain("SHIPYARD_MATCH_AUTH=apple_id");
  }, 120_000);
});

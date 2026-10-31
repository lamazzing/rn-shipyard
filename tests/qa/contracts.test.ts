import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ANSI,
  CLI,
  REPO_ROOT,
  cli,
  has,
  makeFastlaneShim,
  makeProject,
  parseJson,
  run,
  runDir,
  type Project,
  type RunResult,
} from "./support/env.js";
import { IOS_ENV, initIos, seedSuccessfulBuild } from "./support/scenario.js";

/**
 * Contracts that hold for every command, checked on the real CLI process:
 *   2. --json output is ONE parseable document with `success`; failures carry error.code/message/fix;
 *      exit codes are 0, 1 or 2 only.
 *   3. Piped (non-TTY) output and NO_COLOR output contain no ANSI escapes.
 *   4. The credential `init` validated is the one the next step uses.
 * (1, "every question has a non-interactive equivalent", is tests/utils/questions.test.ts.)
 */
const ANDROID_ENV = { ANDROID_KEYSTORE_PASSWORD: "qa-throwaway-pass-1" };

let empty: Project;
let android: Project; // initialised for Android, one successful build in history
let ios: Project; // initialised for iOS (no Apple sign-in possible)

beforeAll(async () => {
  const dir = join(runDir(), "projects", "contracts-empty");
  await mkdir(dir, { recursive: true });
  empty = { layout: "nogit", repo: dir, dir };

  android = await makeProject("root", "contracts-android");
  const init = await cli(["init", "--platform", "android", "--non-interactive"], { cwd: android.dir, env: ANDROID_ENV });
  expect(init.code, init.all).toBe(0);
  await seedSuccessfulBuild(android);

  ios = await makeProject("root", "contracts-ios");
  const i = await initIos(ios, "--non-interactive");
  expect(i.code, i.all).toBe(1);
});

interface Invocation {
  name: string;
  project: () => Project;
  args: string[];
  /** the exact exit code, and the error.code (undefined: success, or a per-platform failure) */
  code: 0 | 1 | 2;
  error: string | undefined;
  env?: Record<string, string>;
}

const invocations: Invocation[] = [
  // no project at all
  { name: "no command", code: 1, error: "INVALID_USAGE",  project: () => empty, args: [] },
  { name: "unknown option", code: 1, error: "INVALID_USAGE",  project: () => empty, args: ["--bogus"] },
  { name: "unknown subcommand", code: 1, error: "INVALID_USAGE",  project: () => empty, args: ["frobnicate"] },
  { name: "doctor outside a project", code: 2, error: "MISSING_CONFIG_PROJECT",  project: () => empty, args: ["doctor"] },
  { name: "doctor bad platform", code: 1, error: "INVALID_FLAGS",  project: () => empty, args: ["doctor", "--platform", "nope"] },
  { name: "build outside a project", code: 2, error: "MISSING_CONFIG_SHIPYARD",  project: () => empty, args: ["build"] },
  { name: "build bad platform", code: 2, error: "MISSING_CONFIG_SHIPYARD",  project: () => empty, args: ["build", "--platform", "nope"] },
  { name: "submit outside a project", code: 2, error: "MISSING_CONFIG_SHIPYARD",  project: () => empty, args: ["submit"] },
  { name: "submit --dry-run outside a project", code: 2, error: "MISSING_CONFIG_SHIPYARD",  project: () => empty, args: ["submit", "--dry-run"] },
  { name: "history outside a project", code: 0, error: undefined,  project: () => empty, args: ["history"] },
  { name: "init outside a project", code: 2, error: "MISSING_CONFIG_PROJECT",  project: () => empty, args: ["init", "--platform", "android"] },
  { name: "init bad platform", code: 2, error: "MISSING_CONFIG_APP",  project: () => empty, args: ["init", "--platform", "nope"] },
  // Android project
  { name: "doctor (android project)", code: 1, error: "REQUIREMENTS_NOT_MET",  project: () => android, args: ["doctor", "--platform", "android"], env: ANDROID_ENV },
  { name: "doctor missing keystore password", code: 1, error: "REQUIREMENTS_NOT_MET",  project: () => android, args: ["doctor", "--platform", "android"] },
  { name: "history", code: 0, error: undefined,  project: () => android, args: ["history"] },
  { name: "history --platform ios (none)", code: 0, error: undefined,  project: () => android, args: ["history", "--platform", "ios"] },
  { name: "build ios, not set up", code: 1, error: "NO_PLATFORMS",  project: () => android, args: ["build", "--platform", "ios"] },
  { name: "build android blocked by the pre-flight", code: 1, error: "REQUIREMENTS_NOT_MET",  project: () => android, args: ["build", "--platform", "android"] },
  { name: "submit --dry-run android", code: 1, error: undefined,  project: () => android, args: ["submit", "--dry-run", "--platform", "android"] },
  { name: "init android again", code: 0, error: undefined,  project: () => android, args: ["init", "--platform", "android"], env: ANDROID_ENV },
  { name: "init ios without Match inputs", code: 2, error: "MISSING_CONFIG_IOS",  project: () => android, args: ["init", "--platform", "ios"] },
  { name: "init --from-eas without credentials.json", code: 2, error: "EAS_CREDENTIALS_NOT_FOUND",  project: () => android, args: ["init", "--from-eas", "--platform", "android"], env: ANDROID_ENV },
  // iOS project
  { name: "init ios, no way to sign in (MATCH_AUTH_MISSING)", code: 1, error: "MATCH_AUTH_MISSING",  project: () => ios, args: ["init", "--platform", "ios"], env: IOS_ENV },
  { name: "doctor (ios project)", code: 1, error: "REQUIREMENTS_NOT_MET",  project: () => ios, args: ["doctor", "--platform", "ios"] },
  { name: "submit --dry-run ios, nothing built", code: 1, error: "NO_ARTIFACTS",  project: () => ios, args: ["submit", "--dry-run", "--platform", "ios"] },
];

describe("--json contract: one document, success, error{code,message,fix}, the exact exit code (0/1/2)", () => {
  for (const inv of invocations) {
    it(inv.name, async () => {
      const r = await cli([...inv.args, "--json", "--non-interactive"], { cwd: inv.project().dir, env: inv.env });
      expect(r.code, `exit code\n${r.all}`).toBe(inv.code);
      const doc = parseJson(r); // the whole of stdout parses as exactly one document
      expect(typeof doc.success, r.stdout).toBe("boolean");
      expect(r.stdout).not.toMatch(ANSI);
      expect(doc.success, r.stdout).toBe(inv.code === 0);
      if (doc.success) return;
      if (doc.error) {
        // the envelope, with real text in all three fields
        expect(Object.keys(doc.error).sort()).toEqual(["code", "fix", "message"]);
        expect(doc.error.code).toBe(inv.error);
        expect(typeof doc.error.message).toBe("string");
        expect(doc.error.message.length).toBeGreaterThan(0);
        expect(typeof doc.error.fix).toBe("string");
      } else {
        expect(inv.error, "a per-platform failure has no top-level error").toBeUndefined();
        // build/submit report per-platform failures (documented: `{ success, platforms, ... }`);
        // each failed platform must still say what failed
        const failed = Object.values(doc.platforms ?? {}).filter((p: any) => p?.status === "error") as any[];
        expect(failed.length, `a failure without error or a failed platform: ${r.stdout}`).toBeGreaterThan(0);
        for (const p of failed) expect(typeof (p.error ?? p.problems?.join("; ")), JSON.stringify(p)).toBe("string");
      }
    });
  }
});

describe("no ANSI escapes when piped or with NO_COLOR", () => {
  const human: Array<[string, () => Project, string[], Record<string, string>?]> = [
    ["doctor", () => android, ["doctor", "--platform", "android"], ANDROID_ENV],
    ["doctor, problems", () => empty, ["doctor"]],
    ["history table", () => android, ["history"]],
    ["build, blocked", () => android, ["build", "--platform", "ios"]],
    ["submit --dry-run", () => android, ["submit", "--dry-run", "--platform", "android"]],
    ["init", () => ios, ["init", "--platform", "ios"], IOS_ENV],
    ["usage error", () => empty, ["--bogus"]],
  ];
  for (const [name, project, args, env] of human) {
    it(`piped: ${name}`, async () => {
      const r = await cli([...args, "--non-interactive"], { cwd: project().dir, env });
      expect(r.stdout + r.stderr).not.toMatch(ANSI);
      expect(r.stdout + r.stderr).not.toContain("\u001b");
    });
  }

  // A real terminal (script allocates a pty), where colour IS on unless NO_COLOR says otherwise
  describe.skipIf(!has("script", ["-q", "/dev/null", "true"]))("on a terminal", () => {
    const tty = (env: string[], args: string[], cwd: string): Promise<RunResult> =>
      run("script", ["-q", "/dev/null", "env", ...env, process.execPath, CLI, ...args], { cwd });

    it("colours by default (so the NO_COLOR check below is not vacuous)", async () => {
      const r = await tty(["TERM=xterm-256color"], ["doctor", "--platform", "android"], android.dir);
      expect(r.stdout).toMatch(ANSI);
    });

    for (const [name, args] of [
      ["doctor", ["doctor", "--platform", "android"]],
      ["history table", ["history"]],
      ["doctor with problems", ["doctor"]],
    ] as const) {
      // chalk 5 ignores NO_COLOR; src/index.ts applies it (applyNoColor)
      it(`NO_COLOR=1: ${name}`, async () => {
        const cwd = name === "doctor with problems" ? empty.dir : android.dir;
        const r = await tty(["TERM=xterm-256color", "NO_COLOR=1"], [...args], cwd);
        expect(r.stdout.length).toBeGreaterThan(0);
        expect(r.stdout).not.toMatch(ANSI);
      });
    }
  });
});

describe("the credential init validated is the one the next step uses", () => {
  // `init` checks an ASC key with a real call to api.appstoreconnect.apple.com. QA has no Apple
  // account, so that one host is answered by a preloaded fetch stub; fastlane itself is a PATH shim
  // that records the Match lane call (its arguments and the credential env it was given).
  const stub = join(REPO_ROOT, "tests", "qa", "support", "stub-fetch.cjs");
  const KEY_ID = "ABC123DEFG";
  const ISSUER = "11111111-2222-3333-4444-555555555555";
  let p8: string;

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    p8 = join(runDir(), "secrets", `AuthKey_${KEY_ID}.p8`);
    await mkdir(join(runDir(), "secrets"), { recursive: true });
    await writeFile(p8, privateKey.export({ type: "pkcs8", format: "pem" }) as string);
  });

  const keyEnv = () => ({ EXPO_ASC_API_KEY_PATH: p8, EXPO_ASC_KEY_ID: KEY_ID, EXPO_ASC_ISSUER_ID: ISSUER, NODE_OPTIONS: `--require ${stub}` });

  it("ASC key configured: the Match lane gets the API-key path, not an Apple ID", async () => {
    const p = await makeProject("root", "cred-asc");
    const shim = await makeFastlaneShim("cred-asc", ["shipyard_match_setup"]);
    const r = await initIos(p, "--json", { ...shim.env, ...keyEnv() });
    expect(r.code, r.all).toBe(0);
    const j = parseJson(r);
    expect(j.setup.ios).toMatchObject({ status: "configured", matchAuth: "api-key", ascKey: "ok" });

    const calls = await shim.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["ios", "shipyard_match_setup"]);
    expect(calls[0].env.APP_STORE_CONNECT_API_KEY_KEY_FILEPATH).toBe(p8);
    expect(calls[0].env.APP_STORE_CONNECT_API_KEY_KEY_ID).toBe(KEY_ID);
    expect(calls[0].env.APP_STORE_CONNECT_API_KEY_ISSUER_ID).toBe(ISSUER);
    expect(calls[0].env.FASTLANE_USER).toBeUndefined();

    // and the generated lane really signs in with it before it calls match
    const fastfile = await readFile(join(p.dir, "fastlane", "Fastfile"), "utf8");
    const lane = fastfile.slice(fastfile.indexOf("lane :shipyard_match_setup"));
    expect(lane.indexOf("APP_STORE_CONNECT_API_KEY_KEY_FILEPATH")).toBeGreaterThan(-1);
    expect(lane.indexOf("app_store_connect_api_key")).toBeLessThan(lane.indexOf("match("));
  });

  it("ASC key AND FASTLANE_USER configured: the key still wins (bug: Match ignored the key)", async () => {
    const p = await makeProject("root", "cred-both");
    const shim = await makeFastlaneShim("cred-both", ["shipyard_match_setup"]);
    const r = await initIos(p, "--json", { ...shim.env, ...keyEnv(), FASTLANE_USER: "someone@example.invalid" });
    expect(r.code, r.all).toBe(0);
    expect(parseJson(r).setup.ios.matchAuth).toBe("api-key");
    const [call] = await shim.calls();
    expect(call.env.APP_STORE_CONNECT_API_KEY_KEY_FILEPATH).toBe(p8);
  });

  it("only an Apple ID configured: the lane gets the Apple ID and no key", async () => {
    const p = await makeProject("root", "cred-appleid");
    const shim = await makeFastlaneShim("cred-appleid", ["shipyard_match_setup"]);
    const r = await initIos(p, "--json", { ...shim.env, FASTLANE_USER: "someone@example.invalid" });
    expect(r.code, r.all).toBe(0);
    expect(parseJson(r).setup.ios.matchAuth).toBe("apple-id");
    const [call] = await shim.calls();
    expect(call.env.FASTLANE_USER).toBe("someone@example.invalid");
    expect(Object.keys(call.env).filter((k) => k.startsWith("APP_STORE_CONNECT_"))).toEqual([]);
  });
});

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { exec } from "../../src/utils/shell.js";

type R = { exitCode: number; stdout: string; stderr: string };
export type Responder = (cmd: string, args: string[], opts: Record<string, unknown>) => R | undefined | Promise<R>;

const ok = (stdout = "", stderr = ""): R => ({ exitCode: 0, stdout, stderr });
export const fail = (stderr = "", exitCode = 1): R => ({ exitCode, stdout: "", stderr });

/** Healthy-machine answers for every command doctor runs. */
export const healthy: Responder = (cmd, args) => {
  const a = args.join(" ");
  if (cmd === "sw_vers") return ok("15.1");
  if (cmd === "git" && a === "--version") return ok("git version 2.45.0");
  if (cmd === "git" && args.includes("ls-remote")) return ok("abc\tHEAD");
  if (cmd === "git" && args[0] === "config") return fail("", 1);
  if (cmd === "ruby") return ok("ruby 3.3.0 (2024-01-01)");
  if (cmd === "which") return ok("/nonexistent/bin/fastlane");
  if (cmd === "fastlane") return ok("fastlane installation at path:\nfastlane 2.225.0");
  if (cmd === "xcode-select") return ok("/Applications/Xcode.app/Contents/Developer");
  if (cmd === "xcodebuild" && args[0] === "-version") return ok("Xcode 16.0\nBuild version 16A242d");
  if (cmd === "xcodebuild") return ok();
  if (cmd === "pod") return ok("1.15.2");
  if (cmd === "java") return ok("", 'openjdk version "17.0.8" 2023-07-18');
  if (cmd === "keytool") return ok("usage");
  if (cmd === "/bin/sh") return ok("PATH=/bin\nSHIPYARD_PROBE.DOTTED.NAME=probe-ok");
  if (cmd === "security") return ok("keychain entry");
  return undefined;
};

/** Install a mock for exec(): `overrides` win over the healthy answers; an undefined answer means "command not found". */
export function mockMachine(...overrides: Responder[]): void {
  vi.mocked(exec).mockImplementation((async (cmd: string, args: string[], opts: Record<string, unknown> = {}) => {
    for (const o of [...overrides, healthy]) {
      const r = await o(cmd, args, opts);
      if (r) return r;
    }
    throw new Error(`spawn ${cmd} ENOENT`);
  }) as never);
}

/** Responder that makes one command "not found". */
export const missing =
  (name: string, firstArg?: string): Responder =>
  (cmd, args) => {
    if (cmd === name && (firstArg === undefined || args[0] === firstArg)) throw new Error(`spawn ${cmd} ENOENT`);
    return undefined;
  };

export const respond =
  (name: string, result: R, firstArg?: string): Responder =>
  (cmd, args) =>
    cmd === name && (firstArg === undefined || args[0] === firstArg) ? result : undefined;

export interface Fixture {
  dir: string;
  home: string;
  sdk: string;
  env: NodeJS.ProcessEnv;
}

export const FAKE = {
  match: "fake-match-password-9d3f",
  keystore: "fake-keystore-password-77aa",
  token: "ghp_faketoken1234567890",
  appPass: "fake-app-specific-pw-5521",
};

/** A complete, healthy Expo project with iOS + Android configured, plus a matching env. */
export async function makeFixture(opts: { ios?: boolean; android?: boolean } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "shipyard-doctor-"));
  const dir = join(root, "app");
  const home = join(root, "home");
  const sdk = join(root, "sdk");
  await mkdir(join(dir, "node_modules", "expo"), { recursive: true });
  await mkdir(join(dir, ".shipyard"), { recursive: true });
  await mkdir(join(sdk, "platform-tools"), { recursive: true });
  await mkdir(join(sdk, "build-tools", "35.0.0"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { expo: "~52.0.0" } }));
  await writeFile(join(dir, "node_modules", "expo", "package.json"), "{}");
  await writeFile(join(dir, "app.json"), "{}");
  await writeFile(
    join(dir, "eas.json"),
    JSON.stringify({ build: {}, submit: { production: { ios: { appleId: "dev@example.com" }, android: {} } } })
  );
  await writeFile(join(home, "release.keystore"), "binary");
  await writeFile(
    join(home, "credentials.json"),
    JSON.stringify({ keystorePassword: FAKE.keystore, keyAlias: "upload" })
  );
  await writeFile(
    join(home, "play.json"),
    JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" })
  );
  const platforms: Record<string, unknown> = {};
  if (opts.ios !== false) {
    platforms.ios = {
      enabled: true,
      signingMethod: "match",
      matchGitUrl: `https://user:${FAKE.token}@github.com/me/certs.git`,
      matchType: "appstore",
      teamId: "TEAM",
      bundleId: "com.x.y",
    };
  }
  if (opts.android !== false) {
    platforms.android = {
      enabled: true,
      keystorePath: join(home, "release.keystore"),
      keystoreAlias: "upload",
      credentialsPath: join(home, "credentials.json"),
      serviceAccountKeyPath: join(home, "play.json"),
    };
  }
  await writeFile(
    join(dir, ".shipyard", "config.json"),
    JSON.stringify({ version: "1", createdAt: "x", platforms, outputDir: "output" })
  );
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    ANDROID_HOME: sdk,
    JAVA_HOME: home,
    HOME: home,
    MATCH_PASSWORD: FAKE.match,
    APP_STORE_CONNECT_API_KEY_KEY_ID: "KEYID",
    APP_STORE_CONNECT_API_KEY_ISSUER_ID: "ISSUER",
    APP_STORE_CONNECT_API_KEY_KEY_FILEPATH: "/tmp/AuthKey.p8",
  };
  return { dir, home, sdk, env };
}

/** Records one successful build per platform in history, with the artifact files on disk. */
export async function addBuiltArtifacts(dir: string, platforms: ("ios" | "android")[] = ["ios", "android"]): Promise<void> {
  await mkdir(join(dir, "output"), { recursive: true });
  const result: Record<string, unknown> = {};
  for (const p of platforms) {
    const file = `output/App-1.0.0-1.${p === "ios" ? "ipa" : "aab"}`;
    await writeFile(join(dir, file), "x");
    result[p] = { status: "success", version: "1.0.0", artifactPath: file, durationSeconds: 1, error: null };
  }
  await writeFile(
    join(dir, ".shipyard", "history.json"),
    JSON.stringify({ entries: [{ id: "a1", timestamp: "2026-01-01T00:00:00Z", command: "build", profile: "production", platforms: result }] })
  );
}

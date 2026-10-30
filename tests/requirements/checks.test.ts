import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { runRequirementChecks, type Platform } from "../../src/requirements/index.js";
import { javaMajor } from "../../src/requirements/android.js";
import { displayGitUrl } from "../../src/requirements/signing.js";
import { mockMachine, missing, respond, fail, makeFixture, FAKE, type Fixture } from "./fixtures.js";

let fx: Fixture;

async function run(id: string, opts: { platforms?: Platform[]; env?: NodeJS.ProcessEnv; nonInteractive?: boolean } = {}) {
  const r = await runRequirementChecks({
    projectDir: fx.dir,
    env: opts.env ?? fx.env,
    platforms: opts.platforms,
    nonInteractive: opts.nonInteractive,
  });
  return r.checks.find((c) => c.id === id);
}

beforeEach(async () => {
  vi.mocked(exec).mockReset();
  mockMachine();
  fx = await makeFixture();
});

describe("a healthy machine and project", () => {
  it("passes everything", async () => {
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env });
    expect(r.checks.filter((c) => c.status === "fail" || c.status === "warn")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.nextStep).toMatch(/^All set\. Run `rn-shipyard build`\.$/);
  });
});

describe("system checks", () => {
  it("macOS: pass, and warn when too old", async () => {
    expect((await run("macos"))?.status).toBe("pass");
    mockMachine(respond("sw_vers", { exitCode: 0, stdout: "12.7", stderr: "" }));
    const c = await run("macos");
    expect(c?.status).toBe("warn");
    expect(c?.fix).toContain("Software Update");
  });

  it("git: fails with the CLT fix when missing", async () => {
    mockMachine(missing("git"));
    const c = await run("git");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toBe("xcode-select --install");
  });

  it("ruby: old system Ruby fails unless Homebrew fastlane brings its own", async () => {
    mockMachine(respond("ruby", { exitCode: 0, stdout: "ruby 2.6.10p210", stderr: "" }));
    const bad = await run("ruby");
    expect(bad?.status).toBe("fail");
    expect(bad?.fix).toContain("brew install fastlane");

    const wrapper = join(fx.home, "fastlane-wrapper");
    await writeFile(wrapper, '#!/bin/bash\nFASTLANE_INSTALLED_VIA_HOMEBREW="true" exec x\n');
    mockMachine(
      respond("ruby", { exitCode: 0, stdout: "ruby 2.6.10p210", stderr: "" }),
      respond("which", { exitCode: 0, stdout: wrapper, stderr: "" })
    );
    const good = await run("ruby");
    expect(good?.status).toBe("pass");
    expect(good?.detail).toContain("2.6.10");
  });

  it("fastlane: missing fails with brew install", async () => {
    mockMachine(missing("fastlane"));
    const c = await run("fastlane");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toBe("brew install fastlane");
  });

  it("command line tools: missing fails", async () => {
    mockMachine(respond("xcode-select", fail("error: unable to get active developer directory"), "-p"));
    const c = await run("xcode-clt", { platforms: ["android"] });
    expect(c?.status).toBe("fail");
    expect(c?.fix).toBe("xcode-select --install");
  });
});

describe("iOS checks", () => {
  it("xcode: missing fails; version below 15 warns", async () => {
    mockMachine(respond("xcodebuild", fail("xcode-select: error: tool 'xcodebuild' requires Xcode", 1), "-version"));
    expect((await run("xcode"))?.status).toBe("fail");
    mockMachine(respond("xcodebuild", { exitCode: 0, stdout: "Xcode 14.3", stderr: "" }, "-version"));
    expect((await run("xcode"))?.status).toBe("warn");
  });

  it("xcode-select pointing at the command line tools fails with the sudo fix", async () => {
    mockMachine(respond("xcode-select", { exitCode: 0, stdout: "/Library/Developer/CommandLineTools", stderr: "" }, "-p"));
    const c = await run("xcode-select");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toContain("sudo xcode-select -s");
  });

  it("license: not accepted fails with the exact command; unavailable xcodebuild skips", async () => {
    mockMachine(respond("xcodebuild", fail("", 69), "-license"));
    const c = await run("xcode-license");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toBe("sudo xcodebuild -license accept");
    mockMachine(missing("xcodebuild", "-license"));
    expect((await run("xcode-license"))?.status).toBe("skip");
  });

  it("cocoapods: missing fails with brew install", async () => {
    mockMachine(missing("pod"));
    const c = await run("cocoapods");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toBe("brew install cocoapods");
  });
});

describe("Android checks", () => {
  it("javaMajor understands old and new version strings", () => {
    expect(javaMajor('openjdk version "17.0.8" 2023')).toBe(17);
    expect(javaMajor('java version "1.8.0_301"')).toBe(8);
    expect(javaMajor("Unable to locate a Java Runtime")).toBeUndefined();
  });

  it("jdk: pass on 17, fail on 11 and when the macOS stub reports no runtime", async () => {
    expect((await run("jdk"))?.status).toBe("pass");
    mockMachine(respond("java", { exitCode: 0, stdout: "", stderr: 'openjdk version "11.0.2"' }));
    const old = await run("jdk");
    expect(old?.status).toBe("fail");
    expect(old?.fix).toBe("brew install --cask zulu@17");
    mockMachine(respond("java", fail("The operation couldn't be completed. Unable to locate a Java Runtime.")));
    expect((await run("jdk"))?.status).toBe("fail");
  });

  it("JAVA_HOME: warn when unset, fail when it points nowhere", async () => {
    const unset = await run("java-home", { env: { ...fx.env, JAVA_HOME: undefined } });
    expect(unset?.status).toBe("warn");
    expect(unset?.fix).toContain("java_home)");
    const bad = await run("java-home", { env: { ...fx.env, JAVA_HOME: join(fx.home, "nope") } });
    expect(bad?.status).toBe("fail");
  });

  it("JAVA_HOME fix uses the java.home of the java on PATH (java_home misses Homebrew openjdk)", async () => {
    const jdk = "/opt/homebrew/Cellar/openjdk/25.0.1/libexec/openjdk.jdk/Contents/Home";
    mockMachine(
      respond("java", {
        exitCode: 0,
        stdout: "",
        stderr: `Property settings:\n    java.home = ${jdk}\n    java.version = 25.0.1\nopenjdk version "25.0.1"`,
      })
    );
    const unset = await run("java-home", { env: { ...fx.env, JAVA_HOME: undefined } });
    expect(unset?.fix).toContain(`export JAVA_HOME="${jdk}"`);
  });

  it("Android SDK: ANDROID_HOME wins; unset with no SDK anywhere fails", async () => {
    expect((await run("android-home"))?.status).toBe("pass");
    const none = await run("android-home", { env: { ...fx.env, ANDROID_HOME: undefined } });
    expect(none?.status).toBe("fail");
    expect(none?.fix).toContain("ANDROID_HOME");
    const bad = await run("android-home", { env: { ...fx.env, ANDROID_HOME: join(fx.home, "nope") } });
    expect(bad?.status).toBe("fail");
    expect(bad?.detail).toContain("does not exist");
  });

  it("Android SDK: ANDROID_SDK_ROOT, android/local.properties and the default location are accepted", async () => {
    const root = await run("android-home", { env: { ...fx.env, ANDROID_HOME: undefined, ANDROID_SDK_ROOT: fx.sdk } });
    expect(root?.status).toBe("pass");
    await mkdir(join(fx.dir, "android"), { recursive: true });
    await writeFile(join(fx.dir, "android", "local.properties"), `sdk.dir=${fx.sdk}\n`);
    const props = await run("android-home", { env: { ...fx.env, ANDROID_HOME: undefined } });
    expect(props?.status).toBe("pass");
    expect(props?.detail).toContain("local.properties");
    await rm(join(fx.dir, "android"), { recursive: true });
    await mkdir(join(fx.home, "Library", "Android"), { recursive: true });
    await symlink(fx.sdk, join(fx.home, "Library", "Android", "sdk"));
    const dflt = await run("android-home", { env: { ...fx.env, ANDROID_HOME: undefined } });
    expect(dflt?.status).toBe("warn");
    expect(dflt?.fix).toContain("ANDROID_HOME");
  });

  it("Android SDK: a set-but-invalid variable only warns when another location is valid", async () => {
    const c = await run("android-home", {
      env: { ...fx.env, ANDROID_HOME: join(fx.home, "nope"), ANDROID_SDK_ROOT: fx.sdk },
    });
    expect(c?.status).toBe("warn");
    expect(c?.detail).toContain("ANDROID_HOME");
  });

  it("SDK packages: pass; platform-tools missing warns; build-tools missing fails; no cmdline-tools assumption", async () => {
    expect((await run("android-packages"))?.detail).toContain("35.0.0");
    await rm(join(fx.sdk, "platform-tools"), { recursive: true });
    const warn = await run("android-packages");
    expect(warn?.status).toBe("warn");
    expect(warn?.detail).toContain("platform-tools");
    expect(warn?.fix).toContain("Android Studio > Settings > Languages & Frameworks > Android SDK > SDK Tools");
    expect(warn?.fix).not.toContain("cmdline-tools/latest");
    await rm(join(fx.sdk, "build-tools"), { recursive: true });
    const bad = await run("android-packages");
    expect(bad?.status).toBe("fail");
    expect(bad?.detail).toBe("missing build-tools and platform-tools");
    expect(bad?.fix).toContain("sdkmanager");
  });

  it("JDK: checks $JAVA_HOME/bin/java when it exists, else java on PATH", async () => {
    await mkdir(join(fx.home, "bin"), { recursive: true });
    await writeFile(join(fx.home, "bin", "java"), "");
    await run("jdk");
    expect(vi.mocked(exec).mock.calls.some(([cmd]) => cmd === join(fx.home, "bin", "java"))).toBe(true);
    vi.mocked(exec).mockClear();
    await run("jdk", { env: { ...fx.env, JAVA_HOME: undefined } });
    expect(vi.mocked(exec).mock.calls.some(([cmd]) => cmd === "java")).toBe(true);
  });

  it("keytool: non-zero exit (macOS stub without a JDK) fails", async () => {
    mockMachine(respond("keytool", fail("Unable to locate a Java Runtime")));
    expect((await run("keytool"))?.status).toBe("fail");
  });

  it("/bin/sh dotted env: fails when the shell drops the variable", async () => {
    mockMachine(respond("/bin/sh", { exitCode: 0, stdout: "PATH=/bin", stderr: "" }));
    const c = await run("sh-env");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toContain("/bin/sh");
  });
});

describe("project checks", () => {
  it("not an Expo project: no package.json", async () => {
    await rm(join(fx.dir, "package.json"));
    const c = await run("expo-project");
    expect(c?.status).toBe("fail");
    expect(c?.configIssue).toBe(true);
  });

  it("package.json without expo fails", async () => {
    await writeFile(join(fx.dir, "package.json"), JSON.stringify({ dependencies: { react: "1" } }));
    expect((await run("expo-project"))?.status).toBe("fail");
  });

  it("dependencies not installed: fix follows the lockfile", async () => {
    await rm(join(fx.dir, "node_modules"), { recursive: true });
    expect((await run("node-modules"))?.fix).toBe("npm install");
    await writeFile(join(fx.dir, "yarn.lock"), "");
    expect((await run("node-modules"))?.fix).toBe("yarn install");
  });

  it("app config: app.config.ts counts, none fails", async () => {
    await rm(join(fx.dir, "app.json"));
    expect((await run("app-config"))?.status).toBe("fail");
    await writeFile(join(fx.dir, "app.config.ts"), "export default {}");
    const c = await run("app-config");
    expect(c?.status).toBe("pass");
    expect(c?.detail).toBe("app.config.ts");
  });

  it("eas.json: missing and invalid fail", async () => {
    await writeFile(join(fx.dir, "eas.json"), "{nope");
    expect((await run("eas-json"))?.detail).toBe("not valid JSON");
    await rm(join(fx.dir, "eas.json"));
    expect((await run("eas-json"))?.status).toBe("fail");
  });

  it("missing .shipyard/config.json says run init and hides the signing group", async () => {
    await rm(join(fx.dir, ".shipyard"), { recursive: true });
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env });
    const c = r.checks.find((x) => x.id === "shipyard-config");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toBe("rn-shipyard init");
    expect(r.checks.some((x) => x.group === "Signing & submit")).toBe(false);
  });

  it("invalid .shipyard/config.json fails", async () => {
    await writeFile(join(fx.dir, ".shipyard", "config.json"), "not json");
    expect((await run("shipyard-config"))?.status).toBe("fail");
  });
});

describe("signing and submit checks", () => {
  it("MATCH_PASSWORD: warn when interactive, fail with --non-interactive, never prints the value", async () => {
    const env = { ...fx.env, MATCH_PASSWORD: undefined };
    expect((await run("match-password", { env }))?.status).toBe("warn");
    expect((await run("match-password", { env, nonInteractive: true }))?.status).toBe("fail");
    expect((await run("match-password"))?.detail).toBe("set");
  });

  it("match repo unreachable is a warning, with non-interactive git settings and no token in the output", async () => {
    mockMachine((cmd, args) => (cmd === "git" && args.includes("ls-remote") ? fail("fatal: could not read Username for 'https://github.com'") : undefined));
    const c = await run("match-repo", { nonInteractive: true });
    expect(c?.status).toBe("warn");
    expect(c?.detail).toContain("needs a username/password or token");
    expect(JSON.stringify(c)).not.toContain(FAKE.token);
    const call = vi.mocked(exec).mock.calls.find(([cmd, a]) => cmd === "git" && a.includes("ls-remote"))!;
    const o = call[2]!;
    expect(call[1].slice(0, 4)).toEqual(["-c", "credential.interactive=never", "-c", "core.askPass=true"]);
    expect(o.env).toMatchObject({
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "true",
      SSH_ASKPASS: "true",
      SSH_ASKPASS_REQUIRE: "never",
      GCM_INTERACTIVE: "never",
    });
    expect(o.env?.GIT_SSH_COMMAND).toContain("BatchMode=yes");
    expect(o.timeout).toBeGreaterThan(0);
    expect(o.redact).toContain(FAKE.token);
  });

  it("match repo keeps the user's ssh command: GIT_SSH_COMMAND, else core.sshCommand, else ssh", async () => {
    const sshOf = () => {
      const call = vi.mocked(exec).mock.calls.filter(([cmd, a]) => cmd === "git" && a.includes("ls-remote")).pop()!;
      return call[2]!.env!.GIT_SSH_COMMAND as string;
    };
    await run("match-repo", { env: { ...fx.env, GIT_SSH_COMMAND: "ssh -i /k/special" } });
    expect(sshOf()).toBe("ssh -i /k/special -o BatchMode=yes -o ConnectTimeout=8");
    mockMachine((cmd, a) => (cmd === "git" && a[0] === "config" ? { exitCode: 0, stdout: "ssh -i ~/.ssh/special\n", stderr: "" } : undefined));
    await run("match-repo");
    expect(sshOf()).toBe("ssh -i ~/.ssh/special -o BatchMode=yes -o ConnectTimeout=8");
    const cfg = vi.mocked(exec).mock.calls.find(([cmd, a]) => cmd === "git" && a[0] === "config")!;
    expect(cfg[2]?.cwd).toBe(fx.dir);
    mockMachine();
    await run("match-repo");
    expect(sshOf()).toBe("ssh -o BatchMode=yes -o ConnectTimeout=8");
  });

  it("https failure with fastlane auth headers set mentions they may be a false alarm", async () => {
    mockMachine((cmd, args) => (cmd === "git" && args.includes("ls-remote") ? fail("fatal: could not read Username") : undefined));
    const plain = await run("match-repo");
    expect(plain?.detail).not.toContain("false alarm");
    const c = await run("match-repo", { env: { ...fx.env, MATCH_GIT_BASIC_AUTHORIZATION: "Zm9vOmJhcg==" } });
    expect(c?.detail).toContain("MATCH_GIT_BASIC_AUTHORIZATION");
    expect(c?.detail).toContain("false alarm");
    expect(JSON.stringify(c)).not.toContain("Zm9vOmJhcg==");
  });

  it("match repo reachable passes with a redacted URL", async () => {
    const c = await run("match-repo");
    expect(c?.status).toBe("pass");
    expect(c?.detail).toBe("https://***@github.com/me/certs.git");
  });

  it("displayGitUrl keeps scp-style URLs and strips https credentials", () => {
    expect(displayGitUrl("git@github.com:me/certs.git")).toBe("git@github.com:me/certs.git");
    expect(displayGitUrl("https://tok@github.com/a/b.git")).toBe("https://***@github.com/a/b.git");
  });

  it("displayGitUrl never leaks a token from an unparseable URL or a query string", () => {
    const bad = displayGitUrl("https://user:tok123@host:abc/x.git");
    expect(bad).toBe("https://***@host:abc/x.git");
    expect(displayGitUrl("https://github.com/a/b.git?token=tok123#frag")).toBe("https://github.com/a/b.git");
    expect(displayGitUrl("https://tok123@github.com/a/b.git?token=tok123")).toBe("https://***@github.com/a/b.git");
    expect(displayGitUrl("ssh://git@host:bad/x?k=tok123")).not.toContain("tok123");
    expect(displayGitUrl("git@github.com:me/certs.git")).toBe("git@github.com:me/certs.git");
  });

  it("fastlane only in a Gemfile (bundle available) warns instead of failing", async () => {
    mockMachine(missing("fastlane"));
    await writeFile(join(fx.dir, "Gemfile"), 'source "https://rubygems.org"\ngem "fastlane"\n');
    const c = await run("fastlane");
    expect(c?.status).toBe("warn");
    expect(c?.detail).toBe("found in Gemfile; rn-shipyard runs `fastlane` from PATH");
    expect(c?.fix).toBe("brew install fastlane");
  });

  it("iOS submit auth: API key passes, Apple ID from eas.json + keychain passes, nothing fails", async () => {
    expect((await run("ios-submit-auth"))?.detail).toContain("API key");
    const noKey = { ...fx.env, APP_STORE_CONNECT_API_KEY_KEY_ID: undefined };
    const viaKeychain = await run("ios-submit-auth", { env: noKey });
    expect(viaKeychain?.status).toBe("pass");
    mockMachine(respond("security", fail("not found", 44)));
    const none = await run("ios-submit-auth", { env: noKey });
    expect(none?.status).toBe("fail");
    expect(none?.fix).toContain("APP_STORE_CONNECT_API_KEY_KEY_ID");
    expect(JSON.stringify(none)).not.toContain("dev@example.com");
  });

  it("Android keystore file missing fails with the init fix", async () => {
    await rm(join(fx.home, "release.keystore"));
    const c = await run("android-keystore");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toContain("rn-shipyard init --platform android");
  });

  it("credentials file: unreadable fails, valid passes", async () => {
    expect((await run("android-credentials-file"))?.status).toBe("pass");
    await writeFile(join(fx.home, "credentials.json"), "{broken");
    expect((await run("android-credentials-file"))?.status).toBe("fail");
  });

  it("passwords: from env, from the file, or missing (and never printed)", async () => {
    const fromFile = await run("android-passwords");
    expect(fromFile?.status).toBe("pass");
    await writeFile(join(fx.home, "credentials.json"), JSON.stringify({ keyAlias: "upload" }));
    expect((await run("android-passwords"))?.status).toBe("fail");
    const viaEnv = await run("android-passwords", { env: { ...fx.env, ANDROID_KEYSTORE_PASSWORD: FAKE.keystore } });
    expect(viaEnv?.status).toBe("pass");
    expect(JSON.stringify(viaEnv)).not.toContain(FAKE.keystore);
  });

  it("Play service account: valid passes; missing config, missing file and wrong shape fail", async () => {
    expect((await run("play-service-account"))?.status).toBe("pass");
    await writeFile(join(fx.home, "play.json"), JSON.stringify({ hello: 1 }));
    expect((await run("play-service-account"))?.detail).toContain("not a service-account key");
    await rm(join(fx.home, "play.json"));
    expect((await run("play-service-account"))?.detail).toContain("cannot read");
    const cfg = JSON.parse(await (await import("node:fs/promises")).readFile(join(fx.dir, ".shipyard", "config.json"), "utf-8"));
    delete cfg.platforms.android.serviceAccountKeyPath;
    await writeFile(join(fx.dir, ".shipyard", "config.json"), JSON.stringify(cfg));
    const c = await run("play-service-account");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toContain("SUPPLY_JSON_KEY");
  });

  it("only platforms configured in .shipyard/config.json get signing checks", async () => {
    const only = await makeFixture({ android: false });
    const r = await runRequirementChecks({ projectDir: only.dir, env: only.env });
    const signing = r.checks.filter((c) => c.group === "Signing & submit").map((c) => c.id);
    expect(signing).toEqual(expect.arrayContaining(["match-password", "match-repo", "ios-submit-auth"]));
    expect(signing.some((id) => id.startsWith("android") || id === "play-service-account")).toBe(false);
  });
});

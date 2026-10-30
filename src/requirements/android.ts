import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type CheckDef, type CheckContext, type Action, DOCS_BASE } from "./types.js";
import { tryExec, isDir, isFile, parseVersion, tildify } from "./helpers.js";
import { shellKeepsDottedEnv, DOTTED_ENV_FIX } from "../platforms/android/shell-env.js";

const DOCS = `${DOCS_BASE}prerequisites`;
const ANDROID: Action[] = ["build-android"];
const JDK_FIX = "brew install --cask zulu@17";

/** Major version from `java -version` output: "17.0.8" -> 17, "1.8.0_301" -> 8. */
export function javaMajor(output: string): number | undefined {
  const m = output.match(/version\s+"([^"]+)"/);
  const v = m ? parseVersion(m[1]) : undefined;
  if (!v) return undefined;
  return v[0] === 1 ? v[1] : v[0];
}

interface SdkLocation {
  dir?: string;
  /** Where dir came from */
  source?: "ANDROID_HOME" | "ANDROID_SDK_ROOT" | "android/local.properties" | "default location";
  /** Set env vars that point at a folder that does not exist */
  invalid: string[];
}

function userHome(env: NodeJS.ProcessEnv): string {
  return env.HOME || homedir();
}

/** ANDROID_HOME, ANDROID_SDK_ROOT, sdk.dir in android/local.properties, then ~/Library/Android/sdk. */
async function locateSdk(ctx: CheckContext): Promise<SdkLocation> {
  const invalid: string[] = [];
  const candidates: [NonNullable<SdkLocation["source"]>, string | undefined][] = [
    ["ANDROID_HOME", ctx.env.ANDROID_HOME],
    ["ANDROID_SDK_ROOT", ctx.env.ANDROID_SDK_ROOT],
  ];
  let fromProps: string | undefined;
  try {
    const props = await readFile(join(ctx.projectDir, "android", "local.properties"), "utf-8");
    fromProps = props.match(/^\s*sdk\.dir\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/\\:/g, ":");
  } catch {
    // no local.properties
  }
  candidates.push(["android/local.properties", fromProps]);
  candidates.push(["default location", join(userHome(ctx.env), "Library", "Android", "sdk")]);
  for (const [source, dir] of candidates) {
    if (!dir) continue;
    if (await isDir(dir)) return { dir, source, invalid };
    if (source === "ANDROID_HOME" || source === "ANDROID_SDK_ROOT") invalid.push(source);
  }
  return { invalid };
}

export const androidChecks: CheckDef[] = [
  {
    id: "jdk",
    group: "Android",
    title: "JDK 17+",
    blocks: ANDROID,
    async run(ctx) {
      // Gradle uses $JAVA_HOME/bin/java when JAVA_HOME is set, so check that one
      const home = ctx.env.JAVA_HOME;
      const java = home && (await isFile(join(home, "bin", "java"))) ? join(home, "bin", "java") : "java";
      const r = await tryExec(java, ["-version"]);
      // macOS ships a `java` stub that exits non-zero when no JDK is installed
      const out = r ? r.stderr || r.stdout : "";
      const major = r && r.exitCode === 0 ? javaMajor(out) : undefined;
      if (major === undefined) {
        return { status: "fail", detail: "no JDK found", fix: JDK_FIX, docs: DOCS };
      }
      const version = out.match(/version\s+"([^"]+)"/)?.[1] ?? String(major);
      if (major < 17) {
        return { status: "fail", detail: `${version} is too old`, fix: JDK_FIX, docs: DOCS };
      }
      return { status: "pass", detail: version };
    },
  },
  {
    id: "java-home",
    group: "Android",
    title: "JAVA_HOME",
    blocks: ANDROID,
    async run(ctx) {
      const home = ctx.env.JAVA_HOME;
      const fix = 'export JAVA_HOME="$(/usr/libexec/java_home)"   (add the line to ~/.zshrc)';
      if (!home) {
        return {
          status: "warn",
          detail: "not set; Gradle will use `java` from PATH",
          fix,
          docs: DOCS,
        };
      }
      if (!(await isDir(home))) {
        return { status: "fail", detail: `${tildify(home, homedir())} does not exist`, fix, docs: DOCS };
      }
      return { status: "pass", detail: tildify(home, homedir()) };
    },
  },
  {
    id: "android-home",
    group: "Android",
    title: "Android SDK found",
    blocks: ANDROID,
    async run(ctx) {
      const loc = await locateSdk(ctx);
      const home = userHome(ctx.env);
      const exportFix = 'export ANDROID_HOME="$HOME/Library/Android/sdk"   (add the line to ~/.zshrc)';
      if (!loc.dir) {
        if (loc.invalid.length > 0) {
          return {
            status: "fail",
            detail: `${loc.invalid.join(" / ")} points to a folder that does not exist`,
            fix: "Point ANDROID_HOME at your SDK folder (Android Studio > Settings > Languages & Frameworks > Android SDK shows the path)",
            docs: DOCS,
          };
        }
        return {
          status: "fail",
          detail: "no Android SDK found",
          fix: `brew install --cask android-studio, open it once so it installs the SDK, then: ${exportFix}`,
          docs: DOCS,
        };
      }
      const shown = tildify(loc.dir, home);
      if (loc.invalid.length > 0) {
        return {
          status: "warn",
          detail: `${loc.invalid.join(" / ")} points to a folder that does not exist; using ${shown} (${loc.source})`,
          fix: `Fix or unset ${loc.invalid.join(" / ")}, e.g. ${exportFix}`,
          docs: DOCS,
        };
      }
      if (loc.source === "default location") {
        return {
          status: "warn",
          detail: `${shown} found, but ANDROID_HOME is not set, so Gradle may not find it`,
          fix: exportFix,
          docs: DOCS,
        };
      }
      return { status: "pass", detail: `${shown} (${loc.source})` };
    },
  },
  {
    id: "android-packages",
    group: "Android",
    title: "SDK build-tools and platform-tools",
    blocks: ANDROID,
    async applies(ctx) {
      return !!(await locateSdk(ctx)).dir;
    },
    async run(ctx) {
      const dir = (await locateSdk(ctx)).dir;
      if (!dir) return { status: "skip", detail: "no SDK to inspect" };
      const hasPlatformTools = await isDir(join(dir, "platform-tools"));
      let buildTools: string[] = [];
      try {
        buildTools = (await readdir(join(dir, "build-tools"))).filter((n) => /^\d/.test(n)).sort();
      } catch {
        // missing folder
      }
      const fix =
        'Android Studio > Settings > Languages & Frameworks > Android SDK > SDK Tools: tick "Android SDK Build-Tools" and "Android SDK Platform-Tools". Or from a terminal: sdkmanager "platform-tools" "build-tools;35.0.0" (sdkmanager is in the SDK\'s cmdline-tools folder)';
      if (buildTools.length === 0) {
        return {
          status: "fail",
          detail: hasPlatformTools ? "missing build-tools" : "missing build-tools and platform-tools",
          fix,
          docs: DOCS,
        };
      }
      if (!hasPlatformTools) {
        return {
          status: "warn",
          detail: `build-tools ${buildTools[buildTools.length - 1]}; platform-tools (adb) missing, only needed to install on a device`,
          fix,
          docs: DOCS,
        };
      }
      return { status: "pass", detail: `build-tools ${buildTools[buildTools.length - 1]}` };
    },
  },
  {
    id: "keytool",
    group: "Android",
    title: "keytool",
    blocks: ANDROID,
    async run() {
      const r = await tryExec("keytool", ["-help"]);
      if (r && r.exitCode === 0) return { status: "pass", detail: "available" };
      return {
        status: "fail",
        detail: "not available (it ships with the JDK)",
        fix: JDK_FIX,
        docs: DOCS,
      };
    },
  },
  {
    id: "sh-env",
    group: "Android",
    title: "/bin/sh keeps env vars with dots",
    blocks: ANDROID,
    async run() {
      if (await shellKeepsDottedEnv()) {
        return { status: "pass", detail: "needed to pass signing passwords to Gradle" };
      }
      return {
        status: "fail",
        detail: "/bin/sh drops them, so Gradle would not receive the signing passwords",
        fix: DOTTED_ENV_FIX,
        docs: `${DOCS_BASE}troubleshooting`,
      };
    },
  },
];

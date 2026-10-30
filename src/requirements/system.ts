import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type CheckDef, type Action, ALL_ACTIONS, DOCS_BASE } from "./types.js";
import { tryExec, parseVersion, versionAtLeast } from "./helpers.js";

const DOCS = `${DOCS_BASE}prerequisites`;

/**
 * Homebrew's fastlane is a wrapper script that runs on Homebrew's own Ruby
 * (brew install fastlane). In that case the system Ruby (macOS ships 2.6) is irrelevant.
 */
export async function fastlaneUsesOwnRuby(): Promise<boolean> {
  try {
    const which = await tryExec("which", ["fastlane"]);
    if (!which || which.exitCode !== 0) return false;
    const head = (await readFile(which.stdout.trim(), "utf-8")).slice(0, 2000);
    return head.includes("FASTLANE_INSTALLED_VIA_HOMEBREW");
  } catch {
    return false;
  }
}

async function gemfileListsFastlane(projectDir: string): Promise<boolean> {
  try {
    return /^\s*gem\s+["']fastlane["']/m.test(await readFile(join(projectDir, "Gemfile"), "utf-8"));
  } catch {
    return false;
  }
}

const BUILD_IOS: Action[] = ["build-ios"];

export const systemChecks: CheckDef[] = [
  {
    id: "macos",
    group: "System",
    title: "macOS",
    blocks: ALL_ACTIONS,
    async run() {
      if (process.platform !== "darwin") {
        return {
          status: "fail",
          detail: `running on ${process.platform}`,
          fix: "rn-shipyard only supports macOS",
          docs: DOCS,
        };
      }
      const r = await tryExec("sw_vers", ["-productVersion"]);
      const v = r && r.exitCode === 0 ? parseVersion(r.stdout) : undefined;
      if (!v) return { status: "pass", detail: "version unknown" };
      const text = r!.stdout.trim();
      if (v[0] < 13) {
        return {
          status: "warn",
          detail: `${text} (Xcode 15 needs macOS 13.5 or newer)`,
          fix: "Update macOS: System Settings > General > Software Update",
          docs: DOCS,
        };
      }
      return { status: "pass", detail: text };
    },
  },
  {
    id: "node",
    group: "System",
    title: "Node.js >= 20",
    blocks: ALL_ACTIONS,
    async run() {
      const version = process.versions.node;
      if ((parseVersion(version)?.[0] ?? 0) >= 20) return { status: "pass", detail: version };
      return {
        status: "fail",
        detail: `${version} is too old`,
        fix: "brew install node",
        docs: DOCS,
      };
    },
  },
  {
    id: "git",
    group: "System",
    title: "git",
    blocks: BUILD_IOS,
    async run() {
      const r = await tryExec("git", ["--version"]);
      if (r && r.exitCode === 0) {
        return { status: "pass", detail: r.stdout.replace(/^git version\s+/, "").trim() };
      }
      return {
        status: "fail",
        detail: "not found (Fastlane Match stores certificates in a git repo)",
        fix: "xcode-select --install",
        docs: DOCS,
      };
    },
  },
  {
    id: "ruby",
    group: "System",
    title: "Ruby >= 2.7",
    blocks: ALL_ACTIONS,
    async run() {
      const r = await tryExec("ruby", ["-v"]);
      const version = r && r.exitCode === 0 ? r.stdout.match(/ruby\s+([\d.]+)/)?.[1] : undefined;
      const parsed = version ? parseVersion(version) : undefined;
      if (parsed && versionAtLeast(parsed, [2, 7])) return { status: "pass", detail: version! };
      if (await fastlaneUsesOwnRuby()) {
        return {
          status: "pass",
          detail: version
            ? `system ${version} ignored, Homebrew fastlane brings its own Ruby`
            : "Homebrew fastlane brings its own Ruby",
        };
      }
      return {
        status: "fail",
        detail: version ? `${version} is too old (macOS ships 2.6)` : "not found",
        fix: "brew install fastlane   (it brings its own Ruby)",
        docs: DOCS,
      };
    },
  },
  {
    id: "fastlane",
    group: "System",
    title: "fastlane",
    blocks: ALL_ACTIONS,
    async run(ctx) {
      const r = await tryExec("fastlane", ["--version"]);
      if (r && r.exitCode === 0) {
        const v = r.stdout.match(/fastlane\s+(\d+\.\d+\.\d+)/)?.[1];
        return { status: "pass", detail: v ?? "installed" };
      }
      if (!r && (await gemfileListsFastlane(ctx.projectDir)) && (await tryExec("which", ["bundle"]))?.exitCode === 0) {
        return {
          status: "warn",
          detail: "found in Gemfile; rn-shipyard runs `fastlane` from PATH",
          fix: "brew install fastlane",
          docs: DOCS,
        };
      }
      return {
        status: "fail",
        detail: r ? "found but `fastlane --version` failed" : "not found",
        fix: "brew install fastlane",
        docs: DOCS,
      };
    },
  },
  {
    id: "xcode-clt",
    group: "System",
    title: "Xcode command line tools",
    blocks: ALL_ACTIONS,
    async run() {
      const r = await tryExec("xcode-select", ["-p"]);
      if (r && r.exitCode === 0 && r.stdout.trim()) return { status: "pass", detail: r.stdout.trim() };
      return {
        status: "fail",
        detail: "not installed",
        fix: "xcode-select --install",
        docs: DOCS,
      };
    },
  },
];

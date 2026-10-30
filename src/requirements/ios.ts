import { type CheckDef, type Action, DOCS_BASE } from "./types.js";
import { tryExec, parseVersion, versionAtLeast } from "./helpers.js";

const DOCS = `${DOCS_BASE}prerequisites`;
const IOS: Action[] = ["build-ios", "submit-ios"];

export const iosChecks: CheckDef[] = [
  {
    id: "xcode",
    group: "iOS",
    title: "Xcode >= 15",
    blocks: IOS,
    async run() {
      const r = await tryExec("xcodebuild", ["-version"]);
      if (r && r.exitCode === 0) {
        const v = r.stdout.match(/Xcode\s+([\d.]+)/)?.[1];
        const parsed = v ? parseVersion(v) : undefined;
        if (parsed && !versionAtLeast(parsed, [15])) {
          return {
            status: "warn",
            detail: `${v} is old; current Expo SDKs need Xcode 15 or newer`,
            fix: "Update Xcode in the Mac App Store",
            docs: DOCS,
          };
        }
        return { status: "pass", detail: v ?? "installed" };
      }
      return {
        status: "fail",
        detail: "Xcode is not installed (the command line tools alone are not enough)",
        fix: "Install Xcode from the Mac App Store (https://apps.apple.com/app/xcode/id497799835), open it once, then run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
        docs: DOCS,
      };
    },
  },
  {
    id: "xcode-select",
    group: "iOS",
    title: "Xcode selected as developer directory",
    blocks: IOS,
    async run() {
      const r = await tryExec("xcode-select", ["-p"]);
      const path = r && r.exitCode === 0 ? r.stdout.trim() : "";
      if (path && !path.includes("CommandLineTools")) return { status: "pass", detail: path };
      return {
        status: "fail",
        detail: path ? `points at ${path}, not at Xcode` : "no developer directory selected",
        fix: "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
        docs: DOCS,
      };
    },
  },
  {
    id: "xcode-license",
    group: "iOS",
    title: "Xcode license accepted",
    blocks: IOS,
    async run() {
      const r = await tryExec("xcodebuild", ["-license", "check"]);
      if (!r) return { status: "skip", detail: "xcodebuild not available" };
      if (r.exitCode === 0) return { status: "pass", detail: "accepted" };
      return {
        status: "fail",
        detail: "not accepted yet",
        fix: "sudo xcodebuild -license accept",
        docs: DOCS,
      };
    },
  },
  {
    id: "cocoapods",
    group: "iOS",
    title: "CocoaPods",
    blocks: ["build-ios"],
    async run() {
      const r = await tryExec("pod", ["--version"]);
      if (r && r.exitCode === 0) return { status: "pass", detail: r.stdout.trim().split("\n").pop() ?? "installed" };
      return {
        status: "fail",
        detail: "not found",
        fix: "brew install cocoapods",
        docs: DOCS,
      };
    },
  },
];

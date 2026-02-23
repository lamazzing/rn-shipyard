import { exec } from "../../utils/shell.js";

export interface CheckResult {
  name: string;
  passed: boolean;
  version?: string;
  required: string;
  fix?: string;
}

export async function checkXcode(): Promise<CheckResult> {
  try {
    const result = await exec("xcodebuild", ["-version"]);
    if (result.exitCode === 0) {
      const versionMatch = result.stdout.match(/Xcode\s+([\d.]+)/);
      return {
        name: "Xcode",
        passed: true,
        version: versionMatch?.[1] ?? "unknown",
        required: ">= 15",
      };
    }
  } catch {}
  return {
    name: "Xcode",
    passed: false,
    required: ">= 15",
    fix: "Install Xcode from the Mac App Store, then run: xcode-select --install",
  };
}

export async function checkCocoaPods(): Promise<CheckResult> {
  try {
    const result = await exec("pod", ["--version"]);
    if (result.exitCode === 0) {
      return {
        name: "CocoaPods",
        passed: true,
        version: result.stdout.trim(),
        required: "latest",
      };
    }
  } catch {}
  return {
    name: "CocoaPods",
    passed: false,
    required: "latest",
    fix: "gem install cocoapods",
  };
}

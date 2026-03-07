import chalk from "chalk";
import { exec } from "../utils/shell.js";
import { printJson } from "../core/output.js";
import { checkXcode, checkCocoaPods } from "../platforms/ios/doctor.js";
import {
  checkAndroidSdk,
  checkJdk,
  checkKeytool,
} from "../platforms/android/doctor.js";

export interface DoctorOptions {
  platform: string;
  json: boolean;
  nonInteractive: boolean;
}

interface CheckResult {
  name: string;
  passed: boolean;
  version?: string;
  required: string;
  fix?: string;
}

async function checkNode(): Promise<CheckResult> {
  try {
    const result = await exec("node", ["-v"]);
    if (result.exitCode === 0) {
      const version = result.stdout.trim().replace(/^v/, "");
      const major = parseInt(version.split(".")[0], 10);
      if (major >= 18) {
        return { name: "Node.js", passed: true, version, required: ">= 18" };
      }
      return {
        name: "Node.js",
        passed: false,
        version,
        required: ">= 18",
        fix: "Update Node.js: brew install node",
      };
    }
  } catch {}
  return {
    name: "Node.js",
    passed: false,
    required: ">= 18",
    fix: "brew install node",
  };
}

async function checkRuby(): Promise<CheckResult> {
  try {
    const result = await exec("ruby", ["-v"]);
    if (result.exitCode === 0) {
      const versionMatch = result.stdout.match(/ruby\s+([\d.]+)/);
      const version = versionMatch?.[1] ?? "unknown";
      const parts = version.split(".").map(Number);
      const passed =
        parts[0] > 2 || (parts[0] === 2 && (parts[1] ?? 0) >= 7);
      return {
        name: "Ruby",
        passed,
        version,
        required: ">= 2.7",
        fix: passed ? undefined : "Update Ruby: brew install ruby",
      };
    }
  } catch {}
  return {
    name: "Ruby",
    passed: false,
    required: ">= 2.7",
    fix: "brew install ruby",
  };
}

async function checkFastlane(): Promise<CheckResult> {
  try {
    const result = await exec("fastlane", ["--version"]);
    if (result.exitCode === 0) {
      const versionMatch = result.stdout.match(/([\d.]+)/);
      return {
        name: "Fastlane",
        passed: true,
        version: versionMatch?.[1] ?? "installed",
        required: "latest",
      };
    }
  } catch {}
  return {
    name: "Fastlane",
    passed: false,
    required: "latest",
    fix: "gem install fastlane",
  };
}

async function checkExpoCli(): Promise<CheckResult> {
  try {
    const result = await exec("npx", ["expo", "--version"]);
    if (result.exitCode === 0) {
      return {
        name: "Expo CLI",
        passed: true,
        version: result.stdout.trim(),
        required: "latest",
      };
    }
  } catch {}
  return {
    name: "Expo CLI",
    passed: false,
    required: "latest",
    fix: "npm install -g expo-cli",
  };
}

export default async function doctorCmd(opts: DoctorOptions): Promise<void> {
  const platform = opts.platform;

  const checks: Promise<CheckResult>[] = [];

  // Common checks
  checks.push(checkNode());
  checks.push(checkRuby());
  checks.push(checkFastlane());
  checks.push(checkExpoCli());

  // iOS checks
  if (platform === "all" || platform === "ios") {
    checks.push(checkXcode());
    checks.push(checkCocoaPods());
  }

  // Android checks
  if (platform === "all" || platform === "android") {
    checks.push(checkAndroidSdk());
    checks.push(checkJdk());
    checks.push(checkKeytool());
  }

  const results = await Promise.allSettled(checks);
  const checkResults: CheckResult[] = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { name: "Unknown", passed: false, required: "unknown", fix: "Check failed" }
  );

  if (opts.json) {
    const allPassed = checkResults.every((r) => r.passed);
    printJson({ success: allPassed, checks: checkResults });
    process.exit(allPassed ? 0 : 1);
    return;
  }

  // Text output
  console.log("");
  console.log(chalk.bold("  rn-shipyard Doctor"));
  console.log(chalk.dim("  ─────────────────────────────────"));
  console.log("");

  let failCount = 0;
  for (const check of checkResults) {
    const status = check.passed ? chalk.green("✓") : chalk.red("✗");
    const version = check.version ? chalk.dim(` (${check.version})`) : "";
    console.log(`  ${status} ${check.name}${version}`);
    if (!check.passed && check.fix) {
      console.log(chalk.dim(`    Fix: ${check.fix}`));
      failCount++;
    }
  }

  console.log("");
  if (failCount > 0) {
    console.log(chalk.red(`  ${failCount} check(s) failed. Fix them before building.`));
    process.exit(1);
  } else {
    console.log(chalk.green("  All checks passed. Ready to build!"));
  }
}

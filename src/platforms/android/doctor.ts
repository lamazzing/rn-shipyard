import { exec } from "../../utils/shell.js";

export interface CheckResult {
  name: string;
  passed: boolean;
  version?: string;
  required: string;
  fix?: string;
}

export async function checkAndroidSdk(): Promise<CheckResult> {
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (androidHome) {
    return {
      name: "Android SDK",
      passed: true,
      version: androidHome,
      required: "ANDROID_HOME set",
    };
  }
  return {
    name: "Android SDK",
    passed: false,
    required: "ANDROID_HOME set",
    fix: "Install Android Studio or set ANDROID_HOME to your SDK path",
  };
}

export async function checkJdk(): Promise<CheckResult> {
  try {
    const result = await exec("java", ["-version"]);
    // java -version outputs to stderr
    const output = result.stderr || result.stdout;
    const versionMatch = output.match(/version\s+"([\d.]+)/);
    const version = versionMatch?.[1] ?? "unknown";
    const major = parseInt(version.split(".")[0], 10);
    if (major >= 11) {
      return {
        name: "JDK",
        passed: true,
        version,
        required: ">= 11",
      };
    }
    return {
      name: "JDK",
      passed: false,
      version,
      required: ">= 11",
      fix: "brew install openjdk@17",
    };
  } catch {}
  return {
    name: "JDK",
    passed: false,
    required: ">= 11",
    fix: "brew install openjdk@17",
  };
}

export async function checkKeytool(): Promise<CheckResult> {
  try {
    const result = await exec("keytool", ["-help"]);
    // keytool -help exits 0 and prints usage
    return {
      name: "keytool",
      passed: true,
      required: "available",
    };
  } catch {}
  return {
    name: "keytool",
    passed: false,
    required: "available",
    fix: "Install JDK (keytool is included): brew install openjdk@17",
  };
}

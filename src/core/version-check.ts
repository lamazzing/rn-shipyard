import { readHistory, getLastSuccessfulBuild, type HistoryEntry } from "./history.js";
import { parseAppConfig, type AppConfig } from "./eas-parser.js";

export interface VersionCheckResult {
  shouldWarn: boolean;
  message: string;
  lastBuild?: HistoryEntry;
}

export async function checkVersion(
  projectDir: string
): Promise<VersionCheckResult> {
  const history = await readHistory(projectDir);
  const lastBuild = getLastSuccessfulBuild(history);

  if (!lastBuild) {
    return {
      shouldWarn: false,
      message: "No previous builds found",
    };
  }

  let appConfig: AppConfig;
  try {
    appConfig = await parseAppConfig(projectDir);
  } catch {
    return {
      shouldWarn: false,
      message: "Could not read app config for version check",
    };
  }

  const currentVersion = appConfig.version;
  const currentIosBuild = appConfig.ios?.buildNumber;
  const currentAndroidCode = appConfig.android?.versionCode;

  // Check iOS
  const lastIos = lastBuild.platforms.ios;
  if (lastIos?.status === "success") {
    if (
      lastIos.version === currentVersion &&
      lastIos.buildNumber === currentIosBuild
    ) {
      return {
        shouldWarn: true,
        message: `iOS version ${currentVersion} (build ${currentIosBuild}) was already built successfully on ${lastBuild.timestamp}. Did you forget to bump the version or build number?`,
        lastBuild,
      };
    }
  }

  // Check Android
  const lastAndroid = lastBuild.platforms.android;
  if (lastAndroid?.status === "success") {
    if (
      lastAndroid.version === currentVersion &&
      lastAndroid.versionCode === currentAndroidCode
    ) {
      return {
        shouldWarn: true,
        message: `Android version ${currentVersion} (versionCode ${currentAndroidCode}) was already built successfully on ${lastBuild.timestamp}. Did you forget to bump the version or versionCode?`,
        lastBuild,
      };
    }
  }

  return {
    shouldWarn: false,
    message: "Version check passed",
  };
}

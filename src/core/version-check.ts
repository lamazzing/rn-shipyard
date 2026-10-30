import { readHistory, getLastSuccessfulBuild, type HistoryEntry } from "./history.js";
import { parseAppConfig, configFieldHint, type AppConfig } from "./eas-parser.js";

export interface VersionCheckResult {
  shouldWarn: boolean;
  message: string;
  lastBuild?: HistoryEntry;
}

export async function checkVersion(
  projectDir: string,
  /** Already evaluated config (build passes it so a dynamic config is not evaluated twice). */
  evaluated?: AppConfig,
  profileEnv: Record<string, string> = {}
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
    appConfig = evaluated ?? (await parseAppConfig(projectDir, profileEnv));
  } catch {
    return {
      shouldWarn: false,
      message: "Could not read app config for version check",
    };
  }

  const currentVersion = appConfig.version;
  const currentIosBuild = appConfig.ios?.buildNumber;

  // Check iOS
  const lastIos = lastBuild.platforms.ios;
  if (lastIos?.status === "success") {
    if (
      lastIos.version === currentVersion &&
      lastIos.buildNumber === currentIosBuild
    ) {
      return {
        shouldWarn: true,
        message: `iOS version ${currentVersion} (build ${currentIosBuild}) was already built successfully on ${lastBuild.timestamp}. Did you forget to bump the version or build number? ${bumpHint(appConfig)}`,
        lastBuild,
      };
    }
  }

  // Android: no check. The versionCode is chosen by build (see version-code.ts)
  // and can never repeat.

  return {
    shouldWarn: false,
    message: "Version check passed",
  };
}

function bumpHint(app: AppConfig): string {
  if (app.source === "app.json") return "Bump expo.version or expo.ios.buildNumber in app.json.";
  return `${app.source} is a dynamic config, so rn-shipyard can't edit it: bump the version or ios.buildNumber in ${app.source} yourself. ${configFieldHint(app.source, "ios.buildNumber", String(Number(app.ios?.buildNumber ?? 0) + 1))}`;
}

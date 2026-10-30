import { ShipyardError } from "../../utils/errors.js";
import { exec } from "../../utils/shell.js";

const PROBE_NAME = "SHIPYARD_PROBE.DOTTED.NAME";
const PROBE_VALUE = "probe-ok";

/**
 * Gradle signing passwords travel as ORG_GRADLE_PROJECT_android.injected.signing.* (names with
 * dots). Fastlane starts gradlew through `/bin/sh -c`, and some shells (zsh, possibly dash)
 * drop environment variables whose names are not valid identifiers. Probe /bin/sh with a dummy
 * dotted variable; no secret is involved.
 */
export async function shellKeepsDottedEnv(): Promise<boolean> {
  try {
    const result = await exec("/bin/sh", ["-c", "env"], {
      env: { [PROBE_NAME]: PROBE_VALUE },
    });
    return result.exitCode === 0 && result.stdout.split(/\r?\n/).includes(`${PROBE_NAME}=${PROBE_VALUE}`);
  } catch {
    return false;
  }
}

export const DOTTED_ENV_FIX =
  "Restore /bin/sh to the system default (on macOS: bash). Check 'ls -l /bin/sh'; do not link it to zsh or dash";

export async function assertShellKeepsDottedEnv(): Promise<void> {
  if (!(await shellKeepsDottedEnv())) {
    throw new ShipyardError(
      "SHELL_DROPS_DOTTED_ENV",
      "/bin/sh drops environment variables with dots in their name, so Gradle would not receive the signing passwords",
      DOTTED_ENV_FIX
    );
  }
}

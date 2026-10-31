import { ShipyardError } from "../utils/errors.js";

/**
 * NO_PLATFORMS for build/submit: names the platform asked for and the exact init command that
 * enables it ("all" or an unknown value: the generic `init`).
 */
export function noPlatformsError(action: "build" | "submit", platform: string): ShipyardError {
  const specific = platform === "ios" || platform === "android";
  return new ShipyardError(
    "NO_PLATFORMS",
    specific ? `${platform === "ios" ? "iOS" : "Android"} is not set up in this project, so there is nothing to ${action}` : `No platforms enabled for ${action}`,
    specific
      ? `Run 'rn-shipyard init --platform ${platform}' to set up ${platform === "ios" ? "iOS" : "Android"}`
      : "Run 'rn-shipyard init' to set up a platform (or 'rn-shipyard init --platform ios|android' for one)"
  );
}

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ShipyardError } from "../../utils/errors.js";

export interface IosWorkspace {
  /** Project-relative path, e.g. ios/My App.xcworkspace */
  workspace: string;
  /** Expo names the scheme after the project, i.e. the workspace basename */
  scheme: string;
}

/**
 * Expo sanitises the iOS project name (spaces, punctuation), so the workspace cannot be
 * derived from app.json's name: look at what prebuild actually generated.
 */
export async function findIosWorkspace(projectDir: string): Promise<IosWorkspace> {
  let entries: string[] = [];
  try {
    entries = await readdir(join(projectDir, "ios"));
  } catch {
    // handled below
  }
  const found = entries.filter((e) => e.endsWith(".xcworkspace")).sort();
  if (found.length === 0) {
    throw new ShipyardError(
      "XCWORKSPACE_NOT_FOUND",
      "No .xcworkspace found in ios/",
      "Run 'npx expo prebuild --platform ios' and check that CocoaPods installed (pod install)"
    );
  }
  if (found.length > 1) {
    throw new ShipyardError(
      "XCWORKSPACE_AMBIGUOUS",
      `Several .xcworkspace folders found in ios/: ${found.join(", ")}`,
      "Keep exactly one workspace in ios/ (delete stale ones), then build again"
    );
  }
  return { workspace: `ios/${found[0]}`, scheme: found[0].slice(0, -".xcworkspace".length) };
}

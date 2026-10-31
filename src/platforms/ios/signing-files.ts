import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";

/**
 * Files the iOS build lane rewrites inside ios/: the Xcode project (manual signing for the app
 * target) and the app's Info.plist (CFBundleVersion). When ios/ is tracked in git the build must
 * put them back, or the user's repo is left dirty. Project-relative paths, forward slashes.
 */
export async function iosLaneTouchedFiles(projectDir: string, workspace: string): Promise<string[]> {
  const iosDir = posix.dirname(workspace); // "ios"
  const pbxprojs = [posix.join(iosDir, workspace.slice(iosDir.length + 1).replace(/\.xcworkspace$/, ".xcodeproj"), "project.pbxproj")];
  // the workspace and the project normally share the name; also cover any other non-Pods project
  try {
    for (const e of await readdir(join(projectDir, iosDir))) {
      if (e.endsWith(".xcodeproj") && e !== "Pods.xcodeproj") {
        const p = posix.join(iosDir, e, "project.pbxproj");
        if (!pbxprojs.includes(p)) pbxprojs.push(p);
      }
    }
  } catch {
    // ios/ unreadable: the lane will fail with its own error
  }

  const files = new Set<string>(pbxprojs);
  for (const pbx of pbxprojs) {
    let text: string;
    try {
      text = await readFile(join(projectDir, pbx), "utf-8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/INFOPLIST_FILE\s*=\s*"?([^";\n]+?)"?\s*;/g)) {
      const rel = m[1].replace(/^\$[({]?(?:SRCROOT|PROJECT_DIR)[)}]?\//, "");
      if (rel.includes("$") || rel.startsWith("/") || rel.split("/").includes("..")) continue;
      files.add(posix.join(iosDir, rel));
    }
  }
  return [...files];
}

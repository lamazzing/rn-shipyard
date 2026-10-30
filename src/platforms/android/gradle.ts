import { readFile, writeFile, readdir, mkdir, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { ShipyardError } from "../../utils/errors.js";

export function appBuildGradlePath(projectDir: string): string {
  return join(projectDir, "android", "app", "build.gradle");
}

/**
 * Sets versionCode in the GENERATED android/app/build.gradle (never in app.json).
 * Throws if the pattern is not found so a build can never ship the wrong code silently.
 */
export async function setGradleVersionCode(
  projectDir: string,
  versionCode: number
): Promise<void> {
  const path = appBuildGradlePath(projectDir);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    throw new ShipyardError(
      "GRADLE_FILE_NOT_FOUND",
      `${path} not found`,
      "Run 'npx expo prebuild --platform android' first"
    );
  }
  const pattern = /^(\s*)versionCode\s+\d+/m;
  if (!pattern.test(content)) {
    throw new ShipyardError(
      "VERSION_CODE_PATCH_FAILED",
      "Could not find 'versionCode N' in android/app/build.gradle",
      "Open an issue: the generated Gradle template changed"
    );
  }
  await writeFile(path, content.replace(pattern, `$1versionCode ${versionCode}`));
}

/** Removes // and /* *\/ comments (good enough for finding a versionCode line). */
function stripGradleComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

/**
 * The integer literal assigned to versionCode in a build script, in Groovy (`versionCode 5`,
 * `versionCode = 5`) or Kotlin DSL (`versionCode = 5`) form. Anything else (a property, an
 * expression, several different literals) is not readable and gives undefined.
 */
export function parseGradleVersionCode(content: string): number | undefined {
  const found = new Set<number>();
  for (const m of stripGradleComments(content).matchAll(/^[ \t]*versionCode[ \t]*=?[ \t]*(\d+)[ \t]*;?[ \t]*$/gm)) {
    found.add(Number(m[1]));
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/** versionCode currently written in android/app/build.gradle(.kts) (a literal), or undefined. */
export async function readGradleVersionCode(projectDir: string): Promise<number | undefined> {
  for (const path of [appBuildGradlePath(projectDir), `${appBuildGradlePath(projectDir)}.kts`]) {
    try {
      return parseGradleVersionCode(await readFile(path, "utf-8"));
    } catch {
      // not there: try the next form
    }
  }
  return undefined;
}

export function gradleBundleDir(projectDir: string): string {
  return join(projectDir, "android", "app", "build", "outputs", "bundle", "release");
}

/** Copy the release AAB produced by Gradle to destPath. Fails loudly if none exists. */
export async function copyReleaseAab(
  projectDir: string,
  destPath: string
): Promise<string> {
  const dir = gradleBundleDir(projectDir);
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".aab"));
  } catch {
    // directory missing
  }
  if (files.length === 0) {
    throw new ShipyardError(
      "AAB_NOT_FOUND",
      `Gradle reported success but no .aab was found in ${dir}`,
      "Check the Gradle output above"
    );
  }
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(join(dir, files[0]), destPath);
  return destPath;
}

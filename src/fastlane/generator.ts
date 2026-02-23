import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import ejs from "ejs";
import type { ShipyardConfig } from "../core/config.js";

function templatesDir(): string {
  return join(__dirname, "..", "templates");
}

async function renderTemplate(
  templateName: string,
  data: Record<string, unknown>
): Promise<string> {
  // Try multiple paths: relative to dist, relative to project root
  const paths = [
    join(__dirname, "..", "templates", templateName),
    join(__dirname, "..", "..", "templates", templateName),
    join(process.cwd(), "templates", templateName),
  ];

  for (const templatePath of paths) {
    try {
      const template = await readFile(templatePath, "utf-8");
      return ejs.render(template, data);
    } catch {
      continue;
    }
  }

  throw new Error(`Template not found: ${templateName}`);
}

export async function generateFastfile(
  projectDir: string,
  config: ShipyardConfig,
  appName: string
): Promise<void> {
  const content = await renderTemplate("Fastfile.ejs", {
    ios: config.platforms.ios,
    android: config.platforms.android,
    appName,
  });

  const fastlaneDir = join(projectDir, "fastlane");
  await mkdir(fastlaneDir, { recursive: true });
  await writeFile(join(fastlaneDir, "Fastfile"), content);
}

export async function generateMatchfile(
  projectDir: string,
  config: ShipyardConfig
): Promise<void> {
  const ios = config.platforms.ios;
  if (!ios) return;

  const content = await renderTemplate("Matchfile.ejs", {
    matchGitUrl: ios.matchGitUrl,
    matchType: ios.matchType,
    bundleId: ios.bundleId,
    teamId: ios.teamId,
  });

  const fastlaneDir = join(projectDir, "fastlane");
  await mkdir(fastlaneDir, { recursive: true });
  await writeFile(join(fastlaneDir, "Matchfile"), content);
}

export async function generateAppfile(
  projectDir: string,
  config: ShipyardConfig,
  appleId?: string,
  packageName?: string
): Promise<void> {
  const content = await renderTemplate("Appfile.ejs", {
    bundleId: config.platforms.ios?.bundleId,
    appleId: appleId ?? "",
    teamId: config.platforms.ios?.teamId,
    packageName: packageName ?? "",
  });

  const fastlaneDir = join(projectDir, "fastlane");
  await mkdir(fastlaneDir, { recursive: true });
  await writeFile(join(fastlaneDir, "Appfile"), content);
}

export async function generateAll(
  projectDir: string,
  config: ShipyardConfig,
  appName: string,
  appleId?: string,
  packageName?: string
): Promise<void> {
  await generateFastfile(projectDir, config, appName);
  if (config.platforms.ios) {
    await generateMatchfile(projectDir, config);
  }
  await generateAppfile(projectDir, config, appleId, packageName);
}

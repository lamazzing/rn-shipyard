import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import ejs from "ejs";
import type { ShipyardConfig } from "../core/config.js";

function templatesDir(): string {
  return join(__dirname, "..", "templates");
}

/**
 * A Ruby double-quoted string literal for any value. Backslash, quote, control characters and
 * every `#` (so `#{x}`, `#$x`, `#@x` can never interpolate) are escaped. Templates use it with
 * `<%- rb(value) %>`; EJS's HTML escaping (`<%=`) would turn `'` into `&#39;`.
 */
export function rubyString(value: unknown): string {
  const s = String(value ?? "");
  let out = "";
  for (const ch of s) {
    switch (ch) {
      case "\\": out += "\\\\"; break;
      case '"': out += '\\"'; break;
      case "#": out += "\\#"; break;
      case "\n": out += "\\n"; break;
      case "\r": out += "\\r"; break;
      case "\t": out += "\\t"; break;
      default: {
        const code = ch.codePointAt(0)!;
        out += code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
      }
    }
  }
  return `"${out}"`;
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
      return ejs.render(template, { ...data, rb: rubyString });
    } catch {
      continue;
    }
  }

  throw new Error(`Template not found: ${templateName}`);
}

/**
 * Keystore fallback written into the committed Fastfile: project-relative only.
 * A keystore outside the project (or a ~/ path) is omitted; build passes keystore_path explicitly.
 */
export function fastfileKeystoreFallback(projectDir: string, p: string | undefined): string | undefined {
  if (!p || p === "~" || p.startsWith("~/")) return undefined;
  const root = resolve(projectDir);
  const rel = isAbsolute(p) ? relative(root, resolve(p)) : relative(root, resolve(root, p));
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}

/** Same rule for the Play service account key: project-relative or omitted, never absolute. */
export const fastfileServiceAccountFallback = fastfileKeystoreFallback;

export async function generateFastfile(
  projectDir: string,
  config: ShipyardConfig,
  appName: string
): Promise<void> {
  const content = await renderTemplate("Fastfile.ejs", {
    ios: config.platforms.ios,
    android: config.platforms.android,
    keystoreFallback: fastfileKeystoreFallback(projectDir, config.platforms.android?.keystorePath),
    serviceAccountFallback: fastfileServiceAccountFallback(projectDir, config.platforms.android?.serviceAccountKeyPath),
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

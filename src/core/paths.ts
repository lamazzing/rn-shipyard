import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Resolve a stored path to an absolute one. Accepts "~/x" (home), absolute
 * (legacy configs) and project-relative paths.
 */
export function resolvePath(projectDir: string, p: string): string {
  if (p === "~" || p.startsWith("~/")) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(projectDir, p);
}

function inside(parent: string, child: string): string | undefined {
  const rel = relative(parent, child);
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}

/**
 * Convert a path to the form stored in .shipyard/*.json so the files carry no
 * machine-specific prefix: project-relative inside the project root, "~/..."
 * under the home directory, otherwise left absolute. Relative input is kept.
 */
export function toPortablePath(projectDir: string, p: string): string {
  if (p === "~" || p.startsWith("~/") || !isAbsolute(p)) return p;
  const abs = resolve(p);
  const inProject = inside(resolve(projectDir), abs);
  if (inProject) return inProject;
  const inHome = inside(homedir(), abs);
  if (inHome) return `~/${inHome}`;
  return abs;
}

/** Entries rn-shipyard keeps out of version control; written to .shipyard/.gitignore */
export const SHIPYARD_GITIGNORE_ENTRIES = [
  "history.json",
  "*.keystore",
  "*.jks",
  "credentials.json",
  "*-credentials.json",
  "*.log",
  "logs/",
];

/**
 * Create .shipyard/.gitignore, or append only the missing entries to an existing
 * one (never rewrites or removes lines the user edited). Returns true if it wrote.
 */
export async function ensureShipyardGitignore(projectDir: string): Promise<boolean> {
  const dir = join(projectDir, ".shipyard");
  const file = join(dir, ".gitignore");
  let content = "";
  let exists = true;
  try {
    content = await readFile(file, "utf-8");
  } catch {
    exists = false;
  }
  const present = new Set(content.split(/\r?\n/).map((l) => l.trim()));
  const missing = SHIPYARD_GITIGNORE_ENTRIES.filter((e) => !present.has(e));
  if (exists && missing.length === 0) return false;

  await mkdir(dir, { recursive: true });
  const header = exists ? "" : "# rn-shipyard: machine-local and secret files\n";
  const sep2 = content === "" || content.endsWith("\n") ? "" : "\n";
  await writeFile(file, content + sep2 + header + missing.join("\n") + "\n");
  return true;
}

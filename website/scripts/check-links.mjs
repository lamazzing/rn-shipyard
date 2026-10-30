// Verifies every internal href/src in dist/ resolves to a built file. No dependencies.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname, resolve, posix } from "node:path";

const dist = resolve("dist");
const rawBase = process.env.BASE_PATH ?? "/rn-shipyard/";
const base = rawBase === "/" || rawBase === "" ? "" : "/" + rawBase.replace(/^\/+|\/+$/g, "");

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

const files = await walk(dist);
const pages = files.filter((f) => f.endsWith(".html"));
const idCache = new Map();
async function idsOf(file) {
  if (!idCache.has(file)) {
    const html = await readFile(file, "utf8");
    idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idCache.get(file);
}

const problems = [];
for (const page of pages) {
  const html = await readFile(page, "utf8");
  const pageUrl = base + "/" + posix.relative(dist, page).replace(/index\.html$/, "");
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    let url = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(url) || url.startsWith("//")) continue;
    const [pathPart, hash] = url.split("#");
    let target;
    if (pathPart === "") target = pageUrl;
    else if (pathPart.startsWith("/")) target = pathPart;
    else target = posix.normalize(posix.join(pageUrl, pathPart));
    const [clean] = target.split("?");
    if (base && !clean.startsWith(base + "/") && clean !== base) {
      problems.push(`${pageUrl}: ${url} is outside base ${base}`);
      continue;
    }
    const rel = base ? clean.slice(base.length) : clean;
    const candidates = rel.endsWith("/") ? [join(dist, rel, "index.html")] : [join(dist, rel), join(dist, rel, "index.html")];
    let found;
    for (const c of candidates) if (await exists(c)) { found = c; break; }
    if (!found) { problems.push(`${pageUrl}: broken link ${url}`); continue; }
    if (hash && found.endsWith(".html") && !(await idsOf(found)).has(decodeURIComponent(hash))) {
      problems.push(`${pageUrl}: missing anchor ${url}`);
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} link problem(s):\n` + [...new Set(problems)].map((p) => "  " + p).join("\n"));
  process.exit(1);
}
console.log(`check-links: ${pages.length} pages, no broken internal links or anchors.`);

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { QUESTIONS } from "../../src/utils/questions.js";
import { createProgram } from "../../src/program.js";

/**
 * Contract: every interactive question has a stable id, and a table says how to answer it without
 * a terminal (a flag, an env var, config, or "never asked"). A prompt added without an id, an id
 * added without a table row, a stale row, or a row naming a flag/env var that does not exist all
 * fail here. See src/utils/questions.ts.
 */
const SRC = join(__dirname, "..", "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const files = sourceFiles(SRC);
const text = new Map(files.map((f) => [relative(SRC, f), readFileSync(f, "utf8")]));

/** Every `.ask(` / `.askSecret(` call outside the prompter itself, with its first argument. */
function promptCalls(): Array<{ file: string; call: string; first: string }> {
  const out: Array<{ file: string; call: string; first: string }> = [];
  for (const [file, src] of text) {
    if (file === join("utils", "prompt.ts") || file === join("utils", "questions.ts")) continue;
    for (const m of src.matchAll(/\.(ask|askSecret)\(\s*([^,)]*)/g)) out.push({ file, call: m[1], first: m[2].trim() });
  }
  return out;
}

describe("question ids", () => {
  const calls = promptCalls();

  it("finds the prompt call sites (the scan itself works)", () => {
    expect(calls.length).toBeGreaterThanOrEqual(10);
  });

  it("every prompt call passes a string-literal id that is in the table", () => {
    const bad = calls.filter((c) => {
      const m = /^"([^"]+)"$/.exec(c.first);
      return !m || !(m[1] in QUESTIONS);
    });
    expect(bad.map((c) => `${c.file}: .${c.call}(${c.first}`)).toEqual([]);
  });

  it("no code reads answers around the prompter (readline, createInterface, stdin reads)", () => {
    // process.stdin.isTTY is a check, not a read
    const around = /node:readline|\.question\(|createInterface|process\.stdin\.(?!isTTY\b)|process\.stdin\[/;
    const offenders = [...text].filter(([f, s]) => f !== join("utils", "prompt.ts") && around.test(s)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("every id in the table is asked somewhere (no stale rows)", () => {
    const used = new Set(calls.map((c) => /^"([^"]+)"$/.exec(c.first)?.[1]));
    expect(Object.keys(QUESTIONS).filter((id) => !used.has(id))).toEqual([]);
  });

  it("every row says how to answer without a terminal", () => {
    for (const [id, q] of Object.entries<any>(QUESTIONS)) {
      const ways = [q.flags?.length, q.env?.length, q.config, q.otherwise].filter(Boolean);
      expect(ways.length, `${id} has no non-interactive equivalent`).toBeGreaterThan(0);
    }
  });

  it("every flag in the table exists on a command", () => {
    const longs = new Set<string>();
    const program = createProgram(["node", "rn-shipyard"]);
    for (const cmd of [program, ...program.commands]) for (const o of cmd.options) if (o.long) longs.add(o.long);
    const missing = Object.entries<any>(QUESTIONS).flatMap(([id, q]) => (q.flags ?? []).filter((f: string) => !longs.has(f)).map((f: string) => `${id}: ${f}`));
    expect(missing).toEqual([]);
  });

  it("every env var in the table is read by the code", () => {
    const code = [...text].filter(([f]) => f !== join("utils", "questions.ts")).map(([, s]) => s).join("\n");
    // an actual read: process.env.NAME, env.NAME or env["NAME"], not a mention in a string or comment
    const read = (name: string) => new RegExp(`\\benv\\.${name}\\b|\\benv\\[["']${name}["']\\]`).test(code);
    const missing = Object.entries<any>(QUESTIONS).flatMap(([id, q]) => (q.env ?? []).filter((e: string) => !read(e)).map((e: string) => `${id}: ${e}`));
    expect(missing).toEqual([]);
  });
});

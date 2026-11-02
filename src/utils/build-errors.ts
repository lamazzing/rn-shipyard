/**
 * Picks the line(s) of a failed build's output that say WHY it failed, so the summary, the
 * --json `error` and the history entry show the real error instead of the first or last thing
 * that happened to be printed. The output is already redacted (exec); nothing here adds text.
 *
 * Order of preference:
 *   1. compiler/signing errors: xcodebuild `error:` (also gym's `▸ error:` and `❌`), a Gradle
 *      "What went wrong" block, Gradle/Kotlin/Java `error:` / `e: ` lines
 *      When such an error line ends with ":" the indented lines right below it carry the reason
 *      (e.g. xcodebuild's "Could not resolve package dependencies:"), so up to a few are kept.
 *   2. fastlane's own `[!]` line (the last one that is not known noise)
 *   3. the last ~15 non-empty lines
 * Known noise (the Gemfile tip, update notices, ...) is ignored at every step.
 */

const MAX_CHARS = 600;
const TAIL_LINES = 15;
const MAX_ERROR_LINES = 3;
const MAX_CONTINUATION_LINES = 4;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
/** fastlane prefixes its log lines with "[12:34:56]: " (only one space is removed: the rest is indentation) */
const TIME_PREFIX = /^\[\d{2}:\d{2}:\d{2}\]: ?/;
/** an indented line, or a gym "▸" line with extra indentation after the marker */
const CONTINUATION = /^(?:\s+\S|\s*▸\s{2,}\S)/;

const NOISE: RegExp[] = [
  /Get started using a Gemfile/i,
  /fastlane\.tools\/(?:getting-started|best-practices)/i,
  /(?:new )?version of fastlane (?:is )?available|fastlane \d[\d.]* is available|update available|Please update using/i,
  /^\s*\[!\]\s*(?:Please|Run)\b.*\b(?:bundle|gem) (?:update|install)/i,
  /^\s*Warning:/i,
];

function isNoise(line: string): boolean {
  return NOISE.some((re) => re.test(line));
}

function clean(raw: string): string[] {
  return raw
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((l) => l.replace(TIME_PREFIX, "").replace(/\s+$/, ""));
}

function strip(line: string): string {
  return line.replace(/^\s*(?:▸\s*|❌\s*|\[!\]\s*)+/, "").trim();
}

function cap(text: string, keepEnd = false): string {
  if (text.length <= MAX_CHARS) return text;
  return keepEnd ? "…" + text.slice(-(MAX_CHARS - 1)) : text.slice(0, MAX_CHARS - 1) + "…";
}

const COMPILER_ERROR = /(?:^|[\s▸❌])error:\s*\S|^\s*e: \S|^\s*❌/;

export function extractBuildError(output: string): string {
  const lines = clean(output);

  // 1a. xcodebuild / gym / javac / kotlinc error lines (unique, in order of appearance)
  const errors: string[] = [];
  const seen = new Set<string>();
  let headers = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!COMPILER_ERROR.test(l) || isNoise(l)) continue;
    const text = strip(l);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    errors.push(text);
    // "error: ...:" announces a reason on the indented lines below it
    if (text.endsWith(":")) {
      let added = 0;
      for (const next of lines.slice(i + 1)) {
        if (!CONTINUATION.test(next)) break;
        if (isNoise(next)) continue;
        const extra = strip(next);
        if (!extra || seen.has(extra)) continue;
        seen.add(extra);
        errors.push(extra);
        if (++added >= MAX_CONTINUATION_LINES) break;
      }
    }
    if (++headers >= MAX_ERROR_LINES) break;
  }
  if (errors.length > 0) return cap(errors.join("\n"));

  // 1b. Gradle: with no compiler error line, the "What went wrong" block names the failing task and the cause
  const gi = lines.findIndex((l) => /^\* What went wrong:/.test(l));
  if (gi >= 0) {
    const block: string[] = [];
    for (const l of lines.slice(gi + 1)) {
      if (l.trim() === "" && block.length > 0) break;
      if (/^\* (?:Try|Exception is|Get more help)/.test(l)) break;
      if (l.trim() !== "" && !isNoise(l)) block.push(l.trim());
      if (block.length >= 6) break;
    }
    if (block.length > 0) return cap(block.join("\n"));
  }

  // 2. fastlane's last meaningful [!] line
  const bang = lines.filter((l) => /^\s*\[!\]/.test(l) && !isNoise(l));
  if (bang.length > 0) return cap(strip(bang[bang.length - 1]));

  // 3. the tail
  const tail = lines.filter((l) => l.trim() !== "" && !isNoise(l)).slice(-TAIL_LINES);
  return cap(tail.join("\n"), true);
}

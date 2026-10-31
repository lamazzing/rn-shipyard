import Table from "cli-table3";
import chalk from "chalk";
import { writeJsonStdout } from "../utils/terminal.js";

export function formatResult(data: unknown, jsonMode: boolean): string {
  if (jsonMode) {
    return JSON.stringify(data, null, 2);
  }

  if (Array.isArray(data)) {
    return formatTable(data);
  }

  return String(data);
}

/**
 * cli-table3 colours its header (red) and borders (grey) with @colors/colors, which ignores
 * TTY and NO_COLOR. chalk already decides correctly (TTY, NO_COLOR, FORCE_COLOR), so follow it:
 * no colour level means no table styles at all.
 */
export function tableStyle(colorLevel: number = chalk.level): { head?: string[]; border?: string[] } {
  return colorLevel > 0 ? {} : { head: [], border: [] };
}

export function formatTable(
  rows: Record<string, unknown>[],
  options?: { head?: string[] }
): string {
  if (rows.length === 0) return "";

  const head = options?.head ?? Object.keys(rows[0]);
  const table = new Table({ head, style: tableStyle() });

  for (const row of rows) {
    table.push(head.map((key) => String(row[key] ?? "")));
  }

  return table.toString();
}

export function printJson(data: unknown): void {
  writeJsonStdout(JSON.stringify(data, null, 2) + "\n");
}

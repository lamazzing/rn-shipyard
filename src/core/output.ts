import Table from "cli-table3";

export function formatResult(data: unknown, jsonMode: boolean): string {
  if (jsonMode) {
    return JSON.stringify(data, null, 2);
  }

  if (Array.isArray(data)) {
    return formatTable(data);
  }

  return String(data);
}

export function formatTable(
  rows: Record<string, unknown>[],
  options?: { head?: string[] }
): string {
  if (rows.length === 0) return "";

  const head = options?.head ?? Object.keys(rows[0]);
  const table = new Table({ head });

  for (const row of rows) {
    table.push(head.map((key) => String(row[key] ?? "")));
  }

  return table.toString();
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

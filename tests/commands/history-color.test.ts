import { describe, it, expect, vi, afterEach } from "vitest";
import chalk from "chalk";

vi.mock("../../src/core/history.js", () => ({ queryHistory: vi.fn() }));

import { queryHistory } from "../../src/core/history.js";
import historyCmd from "../../src/commands/history.js";
import { tableStyle, formatTable } from "../../src/core/output.js";

const entry = {
  id: "a",
  timestamp: "2026-02-23T14:30:00Z",
  command: "build" as const,
  profile: "production",
  platforms: {
    ios: { status: "success" as const, version: "1.0.0", buildNumber: "1", durationSeconds: 5, error: null },
    android: { status: "error" as const, version: "1.0.0", versionCode: 1, durationSeconds: 5, error: "x" },
  },
};

const ESC = String.fromCharCode(27);
const saved = chalk.level;
afterEach(() => {
  chalk.level = saved;
  vi.restoreAllMocks();
});

async function render(level: 0 | 1): Promise<string> {
  chalk.level = level;
  vi.mocked(queryHistory).mockResolvedValueOnce([entry]);
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
  await historyCmd({ json: false, limit: "10", nonInteractive: true });
  return lines.join("\n");
}

describe("history output colour", () => {
  it("is plain when colour is off (piped or NO_COLOR): no escape codes at all", async () => {
    const text = await render(0);
    expect(text).toContain("Platform");
    expect(text).toContain("success");
    expect(text).not.toContain(ESC);
  });

  it("is coloured when colour is on", async () => {
    const text = await render(1);
    expect(text).toContain(ESC);
  });

  it("tableStyle: empty styles without colour, library defaults with it", () => {
    expect(tableStyle(0)).toEqual({ head: [], border: [] });
    expect(tableStyle(2)).toEqual({});
  });

  it("formatTable (shared helper) is plain without colour", () => {
    chalk.level = 0;
    expect(formatTable([{ a: "1" }])).not.toContain(ESC);
  });
});

describe("chalk follows NO_COLOR and non-TTY stdout", () => {
  it("a fresh process with piped stdout and with NO_COLOR prints no escapes", async () => {
    const { execFileSync } = await import("node:child_process");
    const code = `import chalk from "chalk"; process.stdout.write(chalk.red("x"))`;
    const run = (env: Record<string, string>) =>
      execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? "", ...env } }).toString();
    expect(run({})).not.toContain(ESC); // piped: not a TTY
    expect(run({ NO_COLOR: "1" })).not.toContain(ESC);
  });
});

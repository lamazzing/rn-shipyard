import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/commands/build.js", () => ({ default: vi.fn(async () => {}) }));

import { runCli } from "../../src/program.js";
import { setJsonSinkForTests } from "../../src/utils/terminal.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function harness() {
  const json: string[] = [];
  const stderr: string[] = [];
  const restoreSink = setJsonSinkForTests((t) => void json.push(t));
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((t: string) => (stderr.push(String(t)), true)) as never);
  return { json, stderr, restore: restoreSink };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  vi.restoreAllMocks();
});

async function run(argv: string[]): Promise<number | undefined> {
  try {
    await runCli(["node", "rn-shipyard", ...argv]);
  } catch (e) {
    if (e instanceof ExitError) return e.code;
    throw e;
  }
  return undefined;
}

describe("Commander usage errors", () => {
  it("--json: unknown option prints an INVALID_USAGE envelope and exits 1", async () => {
    const h = harness();
    restore = h.restore;
    expect(await run(["build", "--json", "--bogus"])).toBe(1);
    expect(h.json).toHaveLength(1);
    expect(JSON.parse(h.json[0])).toEqual({
      success: false,
      error: {
        code: "INVALID_USAGE",
        message: "unknown option '--bogus'",
        fix: "Run rn-shipyard build --help",
      },
    });
    expect(h.stderr.join("")).toBe(""); // stdout stays a single JSON document
  });

  it("--json: option missing its argument", async () => {
    const h = harness();
    restore = h.restore;
    expect(await run(["--json", "build", "--platform"])).toBe(1);
    const out = JSON.parse(h.json[0]);
    expect(out.success).toBe(false);
    expect(out.error.code).toBe("INVALID_USAGE");
    expect(out.error.message).toContain("--platform");
  });

  it("--json with no command prints a proper INVALID_USAGE envelope and no help text", async () => {
    const h = harness();
    restore = h.restore;
    expect(await run(["--json"])).toBe(1);
    expect(h.json).toHaveLength(1);
    expect(JSON.parse(h.json[0])).toEqual({
      success: false,
      error: { code: "INVALID_USAGE", message: "No command given", fix: "Run rn-shipyard --help" },
    });
    expect(h.stderr.join("")).toBe("");
  });

  it("--json: unknown command", async () => {
    const h = harness();
    restore = h.restore;
    expect(await run(["--json", "nope"])).toBe(1);
    expect(JSON.parse(h.json[0]).error).toMatchObject({ code: "INVALID_USAGE", fix: "Run rn-shipyard --help" });
  });

  it("human mode is unchanged: plain message on stderr, no envelope, exit 1", async () => {
    const h = harness();
    restore = h.restore;
    expect(await run(["build", "--bogus"])).toBe(1);
    expect(h.json).toHaveLength(0);
    expect(h.stderr.join("")).toContain("error: unknown option '--bogus'");
  });

  it("a valid command still runs", async () => {
    const h = harness();
    restore = h.restore;
    expect(await run(["build", "--json"])).toBeUndefined();
    expect(h.json).toHaveLength(0);
  });
});

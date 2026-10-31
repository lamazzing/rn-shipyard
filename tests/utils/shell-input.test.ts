import { describe, it, expect } from "vitest";
import { exec } from "../../src/utils/shell.js";

describe("exec input", () => {
  it("writes the text to the child's stdin and closes it", async () => {
    const r = await exec("cat", [], { input: "from stdin\n" });
    expect(r).toEqual({ exitCode: 0, stdout: "from stdin", stderr: "" });
  });

  it("redacts the secret in the child's output", async () => {
    const r = await exec("cat", [], { input: "the-secret-value", redact: ["the-secret-value"] });
    expect(r.stdout).toBe("***");
  });

  it("a child that never reads stdin does not crash the caller", async () => {
    const r = await exec("true", [], { input: "x".repeat(1_000_000) });
    expect(r.exitCode).toBe(0);
  });
});

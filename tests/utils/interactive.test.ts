import { describe, it, expect, afterEach } from "vitest";
import { isInteractive } from "../../src/utils/interactive.js";

const setTty = (v: boolean) => {
  Object.defineProperty(process.stdin, "isTTY", { value: v, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: v, configurable: true });
};
const savedCi = process.env.CI;
afterEach(() => {
  delete (process.stdin as { isTTY?: boolean }).isTTY;
  delete (process.stdout as { isTTY?: boolean }).isTTY;
  if (savedCi === undefined) delete process.env.CI;
  else process.env.CI = savedCi;
});

describe("isInteractive", () => {
  it("a TTY without flags or CI is interactive", () => {
    delete process.env.CI;
    setTty(true);
    expect(isInteractive({})).toBe(true);
  });
  it("--json, --non-interactive and a missing TTY turn it off", () => {
    delete process.env.CI;
    setTty(true);
    expect(isInteractive({ json: true })).toBe(false);
    expect(isInteractive({ nonInteractive: true })).toBe(false);
    setTty(false);
    expect(isInteractive({})).toBe(false);
  });
  it("CI set (e.g. Buildkite with a pty) turns it off, except 0/false/empty", () => {
    setTty(true);
    for (const v of ["1", "true", "buildkite"]) {
      process.env.CI = v;
      expect(isInteractive({})).toBe(false);
    }
    for (const v of ["0", "false", "FALSE", ""]) {
      process.env.CI = v;
      expect(isInteractive({})).toBe(true);
    }
  });
});

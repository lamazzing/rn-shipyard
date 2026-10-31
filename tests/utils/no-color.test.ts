import { describe, it, expect } from "vitest";
import { applyNoColor } from "../../src/utils/terminal.js";

// https://no-color.org: chalk 5 ignores NO_COLOR, so the CLI sets chalk's level itself (src/index.ts)
describe("applyNoColor", () => {
  it("turns colour off for a non-empty NO_COLOR, even when colour was forced", () => {
    const c = { level: 3 };
    applyNoColor(c, { NO_COLOR: "1", FORCE_COLOR: "3" });
    expect(c.level).toBe(0);
  });

  it("leaves colour alone when NO_COLOR is unset or empty", () => {
    for (const env of [{}, { NO_COLOR: "" }]) {
      const c = { level: 2 };
      applyNoColor(c, env);
      expect(c.level).toBe(2);
    }
  });
});

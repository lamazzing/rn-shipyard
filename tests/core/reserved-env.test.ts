import { describe, it, expect } from "vitest";
import { isReservedEnvName, profileEnvFrom } from "../../src/core/eas-parser.js";

describe("git config variables are reserved (the Match clone redirect is built from them)", () => {
  it.each(["GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_KEY_0", "GIT_CONFIG_KEY_12", "GIT_CONFIG_VALUE_0"])(
    "%s",
    (name) => expect(isReservedEnvName(name)).toBe(true)
  );
  it("a build profile cannot set them", () => {
    const r = profileEnvFrom({ build: { production: { env: { GIT_CONFIG_COUNT: "0", GIT_CONFIG_KEY_0: "x", OK: "1" } } } } as never, "production");
    expect(r.env).toEqual({ OK: "1" });
    expect(r.ignored).toEqual(["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0"]);
  });
});

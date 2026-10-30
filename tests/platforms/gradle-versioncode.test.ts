import { describe, it, expect } from "vitest";
import { parseGradleVersionCode } from "../../src/platforms/android/gradle.js";

describe("parseGradleVersionCode", () => {
  it.each([
    ["Groovy", "defaultConfig {\n    versionCode 5\n    versionName \"1.0\"\n}", 5],
    ["Groovy assignment", "defaultConfig {\n    versionCode = 12\n}", 12],
    ["Kotlin DSL", "defaultConfig {\n    versionCode = 7\n}", 7],
    ["trailing comment", "    versionCode 9 // bump me", 9],
    ["semicolon", "    versionCode = 3;", 3],
  ])("reads %s", (_n, src, expected) => {
    expect(parseGradleVersionCode(src)).toBe(expected);
  });

  it.each([
    ["property", "    versionCode project.property('vc').toInteger()"],
    ["computed", "    versionCode = 100 + 5"],
    ["variable", "    versionCode = computeVersionCode()"],
    ["commented out", "    // versionCode 5\n    /* versionCode 6 */"],
    ["two different literals (flavors)", "    versionCode 1\n    versionCode 2"],
    ["none", "defaultConfig { }"],
  ])("gives up on %s", (_n, src) => {
    expect(parseGradleVersionCode(src)).toBeUndefined();
  });
});

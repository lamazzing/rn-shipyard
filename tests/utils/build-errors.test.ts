import { describe, it, expect } from "vitest";
import { extractBuildError } from "../../src/utils/build-errors.js";

const GEMFILE_TIP = "[!] Get started using a Gemfile for fastlane. https://docs.fastlane.tools/getting-started/ios/setup/#use-a-gemfile";

describe("extractBuildError", () => {
  it("prefers the xcodebuild error over the Gemfile tip printed first (the reported bug)", () => {
    const out = [
      "[10:00:01]: " + GEMFILE_TIP,
      "[10:00:02]: Driving the lane 'ios build' 🚀",
      "[10:03:10]: ▸ Compiling AppDelegate.swift",
      "[10:03:40]: ▸ \u001b[31m❌  error: Signing for \"MyApp\" requires a development team. Select a development team in the Signing & Capabilities editor.\u001b[0m",
      "[10:03:41]: ▸ ** ARCHIVE FAILED **",
      "[10:03:42]: Exit status: 65",
      "[!] Error building the application - see the log above",
    ].join("\n");
    const msg = extractBuildError(out);
    expect(msg).toContain('Signing for "MyApp" requires a development team');
    expect(msg).not.toContain("Gemfile");
    expect(msg).not.toContain("\u001b");
    expect(msg.startsWith("error:")).toBe(true);
  });

  it("reports plain xcodebuild error lines once", () => {
    const out = "/x/App.swift:12:5: error: cannot find 'Foo' in scope\n/x/App.swift:12:5: error: cannot find 'Foo' in scope\nerror: Signing for \"A\" requires a development team.\n";
    const msg = extractBuildError(out);
    expect(msg.split("\n")).toHaveLength(2);
    expect(msg).toContain("cannot find 'Foo'");
  });

  it("uses the Gradle 'What went wrong' block", () => {
    const out = [
      "> Task :app:bundleRelease FAILED",
      "",
      "FAILURE: Build failed with an exception.",
      "",
      "* What went wrong:",
      "Execution failed for task ':app:bundleRelease'.",
      "> A failure occurred while executing SigningConfigWriterTask",
      "   > Keystore file '/k.jks' not found",
      "",
      "* Try:",
      "> Run with --stacktrace option",
      "[!] Exit status of command './gradlew bundle' was 1 instead of 0.",
    ].join("\n");
    const msg = extractBuildError(out);
    expect(msg).toContain("Keystore file '/k.jks' not found");
    expect(msg).not.toContain("Try:");
    expect(msg).not.toContain("Exit status");
  });

  it("prefers a Kotlin/Java compiler error over the generic Gradle summary", () => {
    const out = "e: file:///a/Main.kt:3:1 Unresolved reference: foo\n* What went wrong:\nExecution failed for task ':app:compileKotlin'.\n> Compilation error. See log for more details\n";
    expect(extractBuildError(out)).toContain("Unresolved reference: foo");
  });

  it("falls back to fastlane's last [!] line, skipping the Gemfile tip and update notices", () => {
    const out = [GEMFILE_TIP, "[!] fastlane 2.300.0 is available. Please update using `bundle update fastlane`", "[!] Could not find profile 'x' in the Match repo"].join("\n");
    expect(extractBuildError(out)).toBe("Could not find profile 'x' in the Match repo");
    expect(extractBuildError(GEMFILE_TIP + "\nsomething broke\n")).toBe("something broke");
  });

  it("falls back to the last ~15 non-empty lines", () => {
    const out = Array.from({ length: 40 }, (_, i) => `line ${i + 1}\n`).join("\n");
    const msg = extractBuildError(out).split("\n");
    expect(msg).toHaveLength(15);
    expect(msg[14]).toBe("line 40");
    expect(msg[0]).toBe("line 26");
  });

  it("keeps the end of one huge line and never exceeds the cap", () => {
    const msg = extractBuildError("noise".repeat(400) + "the real end");
    expect(msg.length).toBeLessThanOrEqual(600);
    expect(msg.endsWith("the real end")).toBe(true);
  });

  it("keeps the indented reason lines after an error line ending with a colon", () => {
    const out = [
      "xcodebuild: error: Could not resolve package dependencies:",
      "  Failed to clone repository https://github.com/example/pkg.git:",
      "    fatal: unable to access 'https://github.com/example/pkg.git/': Could not resolve host: github.com",
      "xcodebuild: error: Could not resolve package dependencies:",
    ].join("\n");
    const msg = extractBuildError(out);
    expect(msg).toContain("Failed to clone repository");
    expect(msg).toContain("Could not resolve host");
    expect(msg.split("Could not resolve package dependencies:")).toHaveLength(2);
  });

  it("keeps the reason lines when every line carries a fastlane timestamp", () => {
    const out = [
      "[10:00:00]: xcodebuild: error: Could not resolve package dependencies:",
      "[10:00:00]:   Failed to clone repository https://github.com/example/pkg.git:",
      "[10:00:00]:     fatal: unable to access 'https://github.com/example/pkg.git/': Could not resolve host: github.com",
      "[10:00:01]: xcodebuild: error: Could not resolve package dependencies:",
    ].join("\n");
    const msg = extractBuildError(out);
    expect(msg).toContain("Failed to clone repository");
    expect(msg).toContain("Could not resolve host");
    expect(msg.split("Could not resolve package dependencies:")).toHaveLength(2);
  });

  it("keeps the reason lines of a gym ▸-prefixed error", () => {
    const out = [
      "[10:00:00]: ▸ error: Could not resolve package dependencies:",
      "[10:00:00]: ▸   Failed to clone repository x",
      "[10:00:00]: ▸     fatal: Could not resolve host: github.com",
      "[10:00:00]: ▸ ** BUILD FAILED **",
    ].join("\n");
    const msg = extractBuildError(out);
    expect(msg).toContain("Failed to clone repository x");
    expect(msg).toContain("Could not resolve host");
    expect(msg).not.toContain("BUILD FAILED");
  });

  it("reports a continuation line that is also an error line once", () => {
    const out = "error: A failed:\n  error: B\nerror: B\n";
    expect(extractBuildError(out).split("\n").filter((l) => l.includes("error: B"))).toHaveLength(1);
  });

  it("appends nothing when the colon line is followed by a non-indented line", () => {
    const out = "xcodebuild: error: Something failed:\nnext unindented line\n";
    expect(extractBuildError(out)).toBe("xcodebuild: error: Something failed:");
  });

  it("returns an empty string for empty output", () => {
    expect(extractBuildError("")).toBe("");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { createLogger } from "../../src/utils/logger.js";
import { mockMachine, respond, makeFixture, type Fixture } from "../requirements/fixtures.js";

// tests/setup.ts mocks the module for command tests; this file uses the real pre-flight and runner
const { runPreflight } = await vi.importActual<typeof import("../../src/commands/preflight.js")>(
  "../../src/commands/preflight.js"
);

let fx: Fixture;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(exec).mockReset();
  // Expo SDK 58 (needs Xcode 26.4) with Xcode 16.4, as on the QA runner
  mockMachine(respond("xcodebuild", { exitCode: 0, stdout: "Xcode 16.4\nBuild version 16F6", stderr: "" }, "-version"));
  fx = await makeFixture();
  await writeFile(join(fx.dir, "package.json"), JSON.stringify({ dependencies: { expo: "~58.0.0" } }));
  await writeFile(join(fx.dir, "node_modules", "expo", "package.json"), JSON.stringify({ version: "58.0.1" }));
});

const base = () => ({
  projectDir: fx.dir,
  platforms: ["ios" as const],
  json: true,
  nonInteractive: true,
  logger: createLogger(true),
});

describe("Xcode too old for the Expo SDK blocks only the iOS build", () => {
  it("init's pre-flight (xcode-sdk excluded) is not blocked", async () => {
    const out = await runPreflight({
      ...base(),
      actions: ["build-ios"],
      exclude: ["shipyard-config", "eas-json", "xcode-sdk"],
      excludeGroups: ["Signing & submit"],
    });
    expect(out).toEqual({ ok: true });
  });

  it("submit's pre-flight is not blocked", async () => {
    expect(await runPreflight({ ...base(), actions: ["submit-ios"] })).toEqual({ ok: true });
  });

  it("build's pre-flight is blocked and names xcode-sdk", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = await runPreflight({ ...base(), actions: ["build-ios"] });
    expect(out).toEqual({ ok: false, exitCode: 1 });
    const printed = log.mock.calls.flat().join("\n");
    expect(printed).toContain("REQUIREMENTS_NOT_MET");
    expect(printed).toContain("Xcode 16.4 is too old for Expo SDK 58 (needs 26.4 or newer)");
    log.mockRestore();
  });
});

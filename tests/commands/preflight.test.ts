import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/requirements/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/requirements/index.js")>("../../src/requirements/index.js");
  return { ...actual, runRequirementChecks: vi.fn() };
});
import { runRequirementChecks, type CheckResult, type RequirementsResult } from "../../src/requirements/index.js";
import { createLogger } from "../../src/utils/logger.js";

// tests/setup.ts mocks the module for command tests; this file tests the real one
const { runPreflight } = await vi.importActual<typeof import("../../src/commands/preflight.js")>(
  "../../src/commands/preflight.js"
);

const check = (over: Partial<CheckResult>): CheckResult => ({
  id: "x",
  group: "System",
  title: "Thing",
  blocks: ["build-ios"],
  configIssue: false,
  durationMs: 1,
  status: "pass",
  detail: "ok",
  ...over,
});
const result = (checks: CheckResult[], configOnly = false): RequirementsResult => ({
  ok: checks.every((c) => c.status !== "fail"),
  checks,
  readiness: {},
  summary: { pass: 0, warn: 0, fail: 0, skip: 0 },
  configOnly,
  nextStep: "n",
});

let out: string[];
beforeEach(() => {
  vi.clearAllMocks();
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

const input = (json: boolean) => ({
  projectDir: "/p",
  platforms: ["ios" as const],
  actions: ["build-ios" as const],
  json,
  nonInteractive: true,
  logger: createLogger(json),
});

describe("runPreflight", () => {
  it("passes through to runRequirementChecks without the network match probe or the interactive-aware submit auth check", async () => {
    vi.mocked(runRequirementChecks).mockResolvedValue(result([check({})]));
    expect(await runPreflight(input(false))).toEqual({ ok: true });
    const arg = vi.mocked(runRequirementChecks).mock.calls[0][0];
    expect(arg).toMatchObject({ projectDir: "/p", platforms: ["ios"], actions: ["build-ios"], nonInteractive: true });
    expect(arg.exclude).toEqual(expect.arrayContaining(["match-repo", "ios-submit-auth"]));
  });

  it("forwards init's exclusions", async () => {
    vi.mocked(runRequirementChecks).mockResolvedValue(result([]));
    await runPreflight({ ...input(false), exclude: ["shipyard-config"], excludeGroups: ["Signing & submit"] });
    const arg = vi.mocked(runRequirementChecks).mock.calls[0][0];
    expect(arg.exclude).toContain("shipyard-config");
    expect(arg.excludeGroups).toEqual(["Signing & submit"]);
  });

  it("warnings do not block; they are collected compactly", async () => {
    vi.mocked(runRequirementChecks).mockResolvedValue(result([check({ status: "warn", title: "CocoaPods", detail: "old", fix: "brew upgrade cocoapods" })]));
    const logger = createLogger(true);
    expect(await runPreflight({ ...input(true), logger })).toEqual({ ok: true });
    expect(logger.warnings).toEqual(["CocoaPods: old (brew upgrade cocoapods)"]);
  });

  it("failure (human): grouped ✗ lines with fixes, exit 1", async () => {
    vi.mocked(runRequirementChecks).mockResolvedValue(
      result([check({ status: "fail", title: "Xcode", detail: "not installed", fix: "Install Xcode from the App Store" })])
    );
    expect(await runPreflight(input(false))).toEqual({ ok: false, exitCode: 1 });
    const text = out.join("\n");
    expect(text).toContain("✗");
    expect(text).toContain("Xcode");
    expect(text).toContain("Install Xcode from the App Store");
    expect(text).toContain("--skip-checks");
  });

  it("failure (--json): the doctor envelope with checks and error.code REQUIREMENTS_NOT_MET", async () => {
    vi.mocked(runRequirementChecks).mockResolvedValue(result([check({ status: "fail", title: "Xcode", detail: "missing", fix: "Install" })]));
    expect(await runPreflight(input(true))).toEqual({ ok: false, exitCode: 1 });
    const doc = JSON.parse(out.join("\n"));
    expect(doc.success).toBe(false);
    expect(doc.error.code).toBe("REQUIREMENTS_NOT_MET");
    expect(doc.checks[0]).toMatchObject({ id: "x", status: "fail" });
  });

  it("only missing project config: MISSING_CONFIG_PROJECT, exit 2", async () => {
    vi.mocked(runRequirementChecks).mockResolvedValue(
      result([check({ status: "fail", configIssue: true, title: "App config", detail: "missing", fix: "Run in an Expo project" })], true)
    );
    expect(await runPreflight(input(true))).toEqual({ ok: false, exitCode: 2 });
    expect(JSON.parse(out.join("\n")).error.code).toBe("MISSING_CONFIG_PROJECT");
  });
});

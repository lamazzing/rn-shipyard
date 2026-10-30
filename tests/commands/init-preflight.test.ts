import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn(), registerStdinReleaser: () => () => {} }));
vi.mock("../../src/core/eas-parser.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/eas-parser.js")>()),
  parseEasConfig: vi.fn(async () => null),
  parseAppConfig: vi.fn(async () => ({ name: "A", slug: "a", version: "1.0.0", source: "app.json" })),
}));
import { parseEasConfig } from "../../src/core/eas-parser.js";
import initCmd from "../../src/commands/init.js";
import { runPreflight } from "../../src/commands/preflight.js";
import { runRequirementChecks, type CheckResult } from "../../src/requirements/index.js";

vi.mock("../../src/requirements/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/requirements/index.js")>("../../src/requirements/index.js");
  return { ...actual, runRequirementChecks: vi.fn() };
});

let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
});

describe("init requirements pre-flight", () => {
  it("checks the selected platforms, leaving out shipyard-config and the Signing & submit group", async () => {
    vi.mocked(runPreflight).mockResolvedValueOnce({ ok: false, exitCode: 1 });
    await initCmd({ platform: "ios", json: true, nonInteractive: true });
    expect(exit).toHaveBeenCalledWith(1);
    expect(vi.mocked(runPreflight).mock.calls[0][0]).toMatchObject({
      platforms: ["ios"],
      actions: ["build-ios"],
      exclude: ["shipyard-config", "eas-json"],
      excludeGroups: ["Signing & submit"],
    });
  });

  it("a failed pre-flight stops init before it asks or writes anything", async () => {
    vi.mocked(runPreflight).mockResolvedValueOnce({ ok: false, exitCode: 2 });
    await initCmd({ platform: "all", json: true, nonInteractive: true });
    expect(exit).toHaveBeenCalledWith(2);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runPreflight).mock.calls[0][0].platforms).toEqual(["ios", "android"]);
  });
});

describe("init with the real pre-flight and no eas.json", () => {
  it("excludes eas-json, so init proceeds to its own 'No eas.json found' path", async () => {
    const real = await vi.importActual<typeof import("../../src/commands/preflight.js")>("../../src/commands/preflight.js");
    vi.mocked(runPreflight).mockImplementationOnce(real.runPreflight);
    vi.mocked(parseEasConfig).mockRejectedValueOnce(new Error("ENOENT: no eas.json"));
    const failing = (id: string): CheckResult => ({
      id, group: "Project", title: id, blocks: ["build-ios"], configIssue: false, durationMs: 1,
      status: "fail", detail: "missing", fix: "fix it",
    });
    // stand-in for the check runner: honours `exclude` like the real one
    vi.mocked(runRequirementChecks).mockImplementation(async (input) => {
      const checks = [failing("eas-json")].filter((c) => !input.exclude?.includes(c.id));
      const failed = checks.length > 0;
      return { ok: !failed, checks, readiness: {}, summary: { pass: 0, warn: 0, fail: checks.length, skip: 0 }, configOnly: false, nextStep: "" };
    });
    await initCmd({ platform: "ios", json: false, nonInteractive: true });
    expect(vi.mocked(runRequirementChecks).mock.calls[0][0].exclude).toEqual(expect.arrayContaining(["eas-json", "shipyard-config"]));
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("No eas.json found");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { runRequirementChecks, requirementsError, computeReadiness, ALL_CHECKS } from "../../src/requirements/index.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { exitCodeForError } from "../../src/utils/errors.js";
import { mockMachine, missing, respond, makeFixture, type Fixture } from "./fixtures.js";

let fx: Fixture;
beforeEach(async () => {
  vi.mocked(exec).mockReset();
  mockMachine();
  fx = await makeFixture();
});

describe("platform and action filter", () => {
  it("ios only runs no Android checks", async () => {
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env, platforms: ["ios"] });
    expect(r.checks.some((c) => c.group === "Android")).toBe(false);
    expect(r.checks.some((c) => c.group === "iOS")).toBe(true);
    expect(Object.keys(r.readiness).sort()).toEqual(["build-ios", "submit-ios"]);
  });

  it("android only runs no iOS checks", async () => {
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env, platforms: ["android"] });
    expect(r.checks.some((c) => c.group === "iOS")).toBe(false);
    expect(r.checks.some((c) => c.id === "match-password")).toBe(false);
    expect(r.checks.some((c) => c.id === "play-service-account")).toBe(true);
  });

  it("an explicit action list runs only the checks that block it", async () => {
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env, actions: ["build-android"] });
    expect(r.checks.every((c) => c.blocks.includes("build-android"))).toBe(true);
    expect(r.checks.some((c) => c.id === "play-service-account")).toBe(false);
    expect(Object.keys(r.readiness)).toEqual(["build-android"]);
  });

  it("exclude leaves out checks by id", async () => {
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env, exclude: ["shipyard-config", "pod"] });
    expect(r.checks.some((c) => c.id === "shipyard-config")).toBe(false);
  });

  it("every check id is unique", () => {
    const ids = ALL_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("readiness", () => {
  it("counts only failures that block each action; warnings do not block", async () => {
    mockMachine(missing("pod"), missing("keytool"));
    const env = { ...fx.env, MATCH_PASSWORD: undefined };
    const r = await runRequirementChecks({ projectDir: fx.dir, env });
    expect(r.readiness["build-ios"]).toEqual({ ready: false, problems: 1 }); // pod; MATCH_PASSWORD only warns
    expect(r.readiness["submit-ios"]).toEqual({ ready: true, problems: 0 });
    expect(r.readiness["build-android"]).toEqual({ ready: false, problems: 1 }); // keytool
    expect(r.readiness["submit-android"]).toEqual({ ready: true, problems: 0 });
    expect(r.nextStep).toBe("Fix the 2 items marked ✗ above, then run `rn-shipyard doctor` again.");
  });

  it("computeReadiness on hand-made results", () => {
    const base = { group: "System", title: "t", detail: "", configIssue: false, durationMs: 0 } as const;
    const checks = [
      { ...base, id: "a", status: "fail", blocks: ["build-ios", "submit-ios"] },
      { ...base, id: "b", status: "fail", blocks: ["build-ios"] },
      { ...base, id: "c", status: "warn", blocks: ["build-android"] },
    ] as never;
    expect(computeReadiness(checks, ["build-ios", "submit-ios", "build-android"])).toEqual({
      "build-ios": { ready: false, problems: 2 },
      "submit-ios": { ready: false, problems: 1 },
      "build-android": { ready: true, problems: 0 },
    });
  });

  it("only warnings: ok, and the next step mentions them", async () => {
    const env = { ...fx.env, MATCH_PASSWORD: undefined, };
    mockMachine(respond("xcodebuild", { exitCode: 0, stdout: "Xcode 14.3", stderr: "" }, "-version"));
    const r = await runRequirementChecks({ projectDir: fx.dir, env });
    expect(r.ok).toBe(true);
    expect(r.summary.warn).toBe(2);
    expect(r.nextStep).toBe("Nothing blocks you (2 warnings above). Run `rn-shipyard build`.");
  });
});

describe("timeouts and crashes", () => {
  it("a hanging tool fails that check only, and doctor still returns", async () => {
    mockMachine((cmd) => (cmd === "pod" ? (new Promise(() => {}) as never) : undefined));
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env, timeoutMs: 50 });
    const pod = r.checks.find((c) => c.id === "cocoapods")!;
    expect(pod.status).toBe("fail");
    expect(pod.detail).toContain("did not answer");
    expect(r.checks.find((c) => c.id === "fastlane")?.status).toBe("pass");
  });

  it("a check that throws becomes a failure", async () => {
    mockMachine((cmd) => {
      if (cmd === "sw_vers") return { exitCode: 0, get stdout(): string { throw new Error("boom"); }, stderr: "" } as never;
      return undefined;
    });
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env });
    expect(r.checks.find((c) => c.id === "macos")?.detail).toContain("check crashed");
  });
});

describe("requirementsError", () => {
  it("is undefined when nothing failed", async () => {
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env });
    expect(requirementsError(r)).toBeUndefined();
  });

  it("uses MISSING_CONFIG_PROJECT (exit 2) when only project setup is missing", async () => {
    await rm(join(fx.dir, ".shipyard"), { recursive: true });
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env });
    const err = requirementsError(r)!;
    expect(err.code).toBe("MISSING_CONFIG_PROJECT");
    expect(exitCodeForError(err)).toBe(2);
  });

  it("lists failed checks and fixes under REQUIREMENTS_NOT_MET", async () => {
    mockMachine(missing("pod"));
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env, actions: ["build-ios"] });
    const err = requirementsError(r)!;
    expect(err.code).toBe("REQUIREMENTS_NOT_MET");
    expect(err.message).toContain("CocoaPods");
    expect(err.fix).toContain("brew install cocoapods");
    expect(err.fix).toContain("rn-shipyard doctor");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import doctorCmd, { exitCodeFor, renderReport, toJson } from "../../src/commands/doctor.js";
import { runRequirementChecks } from "../../src/requirements/index.js";
import { mockMachine, missing, respond, makeFixture, addBuiltArtifacts, FAKE, type Fixture } from "../requirements/fixtures.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";

let fx: Fixture;
let out: string[];
let exitCode: number | undefined;
const savedEnv = { ...process.env };

async function runDoctor(opts: { platform?: string; json?: boolean } = {}): Promise<string> {
  out = [];
  exitCode = undefined;
  await doctorCmd({ platform: opts.platform ?? "all", json: opts.json ?? false, nonInteractive: true });
  exitCode = process.exitCode as number | undefined;
  process.exitCode = undefined;
  return out.join("\n");
}

beforeEach(async () => {
  vi.mocked(exec).mockReset();
  mockMachine();
  fx = await makeFixture();
  await addBuiltArtifacts(fx.dir);
  Object.assign(process.env, fx.env, {
    FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD: FAKE.appPass,
    ANDROID_KEYSTORE_PASSWORD: FAKE.keystore,
  });
  vi.spyOn(process, "cwd").mockReturnValue(fx.dir);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

describe("doctor command", () => {
  it("healthy: exit 0, readiness lists everything, one-line group summaries", async () => {
    const text = await runDoctor();
    expect(exitCode).toBe(0);
    expect(text).toContain("Ready:");
    expect(text).toContain("iOS build, iOS submit, Android build, Android submit");
    expect(text).not.toContain("Not ready:");
    expect(text).toContain("Next step: All set. Run `rn-shipyard build`.");
    expect(text.split("\n").length).toBeLessThan(24);
  });

  it("a failure: exit 1, shows Fix and Docs under the check, and the Not ready line", async () => {
    mockMachine(missing("pod"));
    const text = await runDoctor();
    expect(exitCode).toBe(1);
    expect(text).toMatch(/✗ CocoaPods/);
    expect(text).toContain("Fix:  brew install cocoapods");
    expect(text).toContain("Docs: https://github.com/lamazzing/rn-shipyard#prerequisites");
    expect(text).toContain("Not ready:  iOS build (1 problem)");
    expect(text).toContain("Ready:      iOS submit, Android build, Android submit");
    expect(text).toContain("Next step: Fix the item marked ✗ above");
  });

  it("warnings alone exit 0 and show !", async () => {
    mockMachine(respond("xcodebuild", { exitCode: 0, stdout: "Xcode 14.3", stderr: "" }, "-version"));
    const text = await runDoctor();
    expect(exitCode).toBe(0);
    expect(text).toContain("! Xcode >= 15");
  });

  it("exit 2 when the only failures are missing project config", async () => {
    await rm(join(fx.dir, ".shipyard"), { recursive: true });
    const text = await runDoctor();
    expect(exitCode).toBe(2);
    expect(text).toContain("Fix:  rn-shipyard init");
    expect(text).toContain("Run `rn-shipyard init`");
  });

  it("exit 1 (not 2) when a tool is missing as well as config", async () => {
    await rm(join(fx.dir, ".shipyard"), { recursive: true });
    mockMachine(missing("fastlane"));
    await runDoctor();
    expect(exitCode).toBe(1);
  });

  it("--platform android leaves out iOS", async () => {
    const text = await runDoctor({ platform: "android" });
    expect(text).not.toContain("iOS build");
    expect(text).not.toMatch(/\biOS\b/);
    expect(text).toContain("Android build, Android submit");
  });

  it("--platform bogus is an INVALID_FLAGS error", async () => {
    await expect(doctorCmd({ platform: "windows", json: false, nonInteractive: true })).rejects.toMatchObject({
      code: "INVALID_FLAGS",
    });
  });

  it("--json: envelope with checks, readiness, summary and nextStep", async () => {
    const text = await runDoctor({ json: true });
    const j = JSON.parse(text);
    expect(j.success).toBe(true);
    expect(exitCode).toBe(0);
    expect(j.error).toBeUndefined();
    expect(j.checks[0]).toEqual(
      expect.objectContaining({ id: "macos", group: "System", title: expect.any(String), status: "pass", detail: "15.1" })
    );
    expect(j.checks[0].blocks).toContain("build-ios");
    expect(j.readiness["build-android"]).toEqual({ ready: true, problems: 0 });
    expect(j.summary.fail).toBe(0);
    expect(typeof j.nextStep).toBe("string");
  });

  it("--json failure: success false, error envelope with REQUIREMENTS_NOT_MET, exit 1", async () => {
    mockMachine(missing("fastlane"));
    const j = JSON.parse(await runDoctor({ json: true }));
    expect(exitCode).toBe(1);
    expect(j.success).toBe(false);
    expect(j.error).toEqual({
      code: "REQUIREMENTS_NOT_MET",
      message: expect.stringContaining("fastlane"),
      fix: expect.stringContaining("brew install fastlane"),
    });
    const f = j.checks.find((c: { id: string }) => c.id === "fastlane");
    expect(f).toMatchObject({ status: "fail", fix: "brew install fastlane" });
  });

  it("never prints secret values, in text or JSON, even when a check fails", async () => {
    mockMachine((cmd, args) =>
      cmd === "git" && args[0] === "ls-remote"
        ? { exitCode: 128, stdout: "", stderr: `fatal: unable to access https://user:${FAKE.token}@github.com/me/certs.git` }
        : undefined
    );
    await rm(join(fx.home, "play.json"));
    const all = (await runDoctor()) + (await runDoctor({ json: true }));
    for (const secret of [FAKE.match, FAKE.keystore, FAKE.token, FAKE.appPass]) {
      expect(all).not.toContain(secret);
    }
    expect(all).toContain("github.com/me/certs.git"); // the redacted URL is shown
  });
});

describe("helpers", () => {
  it("exitCodeFor and renderReport work on a result object", async () => {
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env, platforms: ["android"] });
    expect(exitCodeFor(r)).toBe(0);
    expect(renderReport(r).join("\n")).toContain("Android");
    expect(toJson(r).success).toBe(true);
  });
});

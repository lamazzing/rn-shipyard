import { describe, it, expect, vi, beforeEach } from "vitest";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { runRequirementChecks } from "../../src/requirements/index.js";
import { toJson, renderReport } from "../../src/commands/doctor.js";
import { mockMachine, makeFixture, addBuiltArtifacts, respond, fail, type Fixture } from "./fixtures.js";

let fx: Fixture;
beforeEach(async () => {
  vi.mocked(exec).mockReset();
  mockMachine();
});

const check = (f: Fixture, extra: Record<string, unknown> = {}) =>
  runRequirementChecks({ projectDir: f.dir, env: f.env, assessReadiness: true, ...extra });

describe("doctor readiness: platform setup and artifacts", () => {
  it("a platform missing from the config is 'not set up', never Ready", async () => {
    fx = await makeFixture({ ios: false });
    await addBuiltArtifacts(fx.dir, ["android"]);
    const r = await check(fx);
    expect(r.readiness["build-ios"]).toMatchObject({ ready: false, state: "not-set-up" });
    expect(r.readiness["submit-ios"]).toMatchObject({ ready: false, state: "not-set-up" });
    expect(r.readiness["build-ios"]?.note).toContain("rn-shipyard init --platform ios");
    expect(r.readiness["build-android"]?.ready).toBe(true);
    expect(r.readiness["submit-android"]?.ready).toBe(true);
    expect(r.ok).toBe(true);
    const text = renderReport(r).join("\n");
    expect(text).toContain("Ready:      Android build, Android submit");
    expect(text).toContain("iOS build (not set up: run `rn-shipyard init --platform ios`)");
    expect(r.nextStep).toBe("All set. Run `rn-shipyard build --platform android`.");
  });

  it("submit needs a built artifact that still exists", async () => {
    fx = await makeFixture();
    const none = await check(fx);
    expect(none.readiness["build-ios"]?.ready).toBe(true);
    expect(none.readiness["submit-ios"]).toMatchObject({ ready: false, state: "no-artifact" });
    expect(none.readiness["submit-ios"]?.note).toBe("no .ipa yet: run `rn-shipyard build --platform ios`");
    expect(none.readiness["submit-android"]?.note).toBe("no .aab yet: run `rn-shipyard build --platform android`");

    await addBuiltArtifacts(fx.dir);
    expect((await check(fx)).readiness["submit-ios"]?.ready).toBe(true);

    await rm(join(fx.dir, "output", "App-1.0.0-1.ipa"));
    const gone = await check(fx);
    expect(gone.readiness["submit-ios"]?.state).toBe("no-artifact");
    expect(gone.readiness["submit-android"]?.ready).toBe(true);
  });

  it("a failed build in history is not an artifact", async () => {
    fx = await makeFixture();
    await addBuiltArtifacts(fx.dir);
    await writeFile(
      join(fx.dir, ".shipyard", "history.json"),
      JSON.stringify({ entries: [{ id: "a", timestamp: "t", command: "build", profile: "p", platforms: { ios: { status: "error", version: "1", artifactPath: "output/App-1.0.0-1.ipa", durationSeconds: 1, error: "x" } } }] })
    );
    expect((await check(fx)).readiness["submit-ios"]?.state).toBe("no-artifact");
  });

  it("a failing check still counts as problems, not as no-artifact", async () => {
    fx = await makeFixture();
    mockMachine(respond("pod", fail("nope")));
    const r = await check(fx);
    expect(r.readiness["build-ios"]).toEqual({ ready: false, problems: 1 });
  });

  it("nothing set up: next step is init", async () => {
    fx = await makeFixture({ ios: false, android: false });
    const r = await check(fx);
    expect(r.nextStep).toBe("Run `rn-shipyard init --platform ios` to set up a platform.");
  });

  it("--json carries state and note", async () => {
    fx = await makeFixture({ ios: false });
    const json = toJson(await check(fx)) as { readiness: Record<string, { state?: string; note?: string }> };
    expect(json.readiness["build-ios"]).toMatchObject({ ready: false, state: "not-set-up" });
  });

  it("pre-flight mode (no assessReadiness): submit does not need an artifact, unconfigured platforms unchanged", async () => {
    fx = await makeFixture();
    const r = await runRequirementChecks({ projectDir: fx.dir, env: fx.env, platforms: ["ios"], actions: ["build-ios", "submit-ios"] });
    expect(r.ok).toBe(true);
    expect(r.readiness["submit-ios"]).toEqual({ ready: true, problems: 0 });
  });

  it("without a readable config, readiness is left to the failed config check", async () => {
    fx = await makeFixture();
    await rm(join(fx.dir, ".shipyard", "config.json"));
    const r = await check(fx);
    expect(r.readiness["build-ios"]?.state).toBeUndefined();
    expect(r.ok).toBe(false);
    await mkdir(join(fx.dir, ".shipyard"), { recursive: true });
  });
});

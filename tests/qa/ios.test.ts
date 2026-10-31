import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { APP_ID, cli, iosSkipReason, requireOrSkip, makeBareRepo, makeFastlaneShim, makeNativeProject, makeProject, parseJson, run } from "./support/env.js";
import { initIos } from "./support/scenario.js";

/**
 * iOS without an Apple account: no signing, no Match repo, no upload. What can still be proven
 * with real tools is everything before Apple is involved.
 */
const skip = requireOrSkip(iosSkipReason());
if (skip) console.warn(`[qa] iOS scenarios skipped: ${skip}`);

describe.skipIf(!!skip)("ios (no Apple account)", () => {
  it("init --non-interactive with no ASC key and no FASTLANE_USER reports MATCH_AUTH_MISSING without starting fastlane", async () => {
    const p = await makeProject("root", "ios-auth-missing");
    // every Match lane call is recorded and answered with success: none must happen
    const shim = await makeFastlaneShim("auth-missing", ["shipyard_match_setup", "shipyard_match_import", "shipyard_apple_login"]);
    const r = await initIos(p, "--json", shim.env);
    expect(r.code, r.all).toBe(1);
    const j = parseJson(r);
    expect(j.success).toBe(false);
    expect(j.error).toMatchObject({ code: "MATCH_AUTH_MISSING" });
    expect(typeof j.error.fix).toBe("string");
    expect(j.setup.ios).toMatchObject({ status: "failed", errorCode: "MATCH_AUTH_MISSING" });
    expect(j.setup.ios.nextStep).toMatch(/EXPO_ASC_API_KEY_PATH|FASTLANE_USER/);
    expect(await shim.calls()).toEqual([]);

    // the human output says the same, once, and still does not reach fastlane
    const human = await initIos(p, "--non-interactive", shim.env);
    expect(human.code, human.all).toBe(1);
    expect(human.all).toMatch(/neither an App Store Connect API key nor an Apple ID/);
    expect(await shim.calls()).toEqual([]);
  });

  it(
    "prebuild + pods + the real shipyard_ios_resolve lane find the Xcode project from fastlane/ (the 0.3.0 path bug)",
    async () => {
      const p = await makeNativeProject("ios-resolve");
      // build clones the Match repo before the lane starts: an empty local bare repo serves
      const remote = await makeBareRepo("ios-resolve-match");
      const init = await initIos(p, "--non-interactive", { MATCH_GIT_URL: remote });
      expect(init.code, init.all).toBe(1);

      // `build` runs the real expo prebuild and pod install, then hands the Xcode work to the build
      // lane; the shim records what rn-shipyard passes and stops there (no signing without Apple)
      const shim = await makeFastlaneShim("ios-resolve", ["build"], 1);
      const build = await cli(["build", "--platform", "ios", "--non-interactive", "--json", "--skip-checks", "--skip-version-check"], {
        cwd: p.dir,
        env: shim.env,
        timeoutMs: 20 * 60_000,
      });
      const calls = await shim.calls();
      expect(calls, build.all).toHaveLength(1);
      expect(calls[0].args.slice(0, 2)).toEqual(["ios", "build"]);
      const arg = (name: string) => calls[0].args.find((a) => a.startsWith(`${name}:`))?.slice(name.length + 1);
      const workspace = arg("workspace");
      const scheme = arg("scheme");
      expect(workspace, "the build lane gets a workspace").toBeTruthy();
      expect(existsSync(workspace!), `${workspace} exists after prebuild + pods`).toBe(true);
      expect((await readdir(join(p.dir, "ios"))).some((e) => e.endsWith(".xcworkspace"))).toBe(true);

      // now the REAL lane, with exactly the arguments the CLI produced, and with a relative one
      for (const ws of [workspace!, `ios/${basename(workspace!)}`]) {
        const lane = await run("fastlane", ["ios", "shipyard_ios_resolve", `workspace:${ws}`, `scheme:${scheme}`, `bundle_id:${APP_ID}`], {
          cwd: p.dir,
          env: { CI: "1" },
          timeoutMs: 10 * 60_000,
        });
        expect(lane.code, lane.all).toBe(0);
        const m = /SHIPYARD_RESOLVED project=(\S+) target=(\S+) plist=(\S+)/.exec(lane.all);
        expect(m, lane.all).toBeTruthy();
        expect(existsSync(m![1]), `project ${m![1]}`).toBe(true);
        expect(existsSync(m![3]), `plist ${m![3]}`).toBe(true);
        expect(m![1].startsWith(p.dir) || m![1].startsWith(join("/private", p.dir)), `resolved inside the project, not under fastlane/: ${m![1]}`).toBe(true);
        expect(m![1]).not.toContain("/fastlane/");
      }
    },
    40 * 60_000
  );
});

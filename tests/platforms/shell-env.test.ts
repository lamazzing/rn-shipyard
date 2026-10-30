import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { shellKeepsDottedEnv, assertShellKeepsDottedEnv } from "../../src/platforms/android/shell-env.js";
import { runRequirementChecks } from "../../src/requirements/index.js";

const ok = { exitCode: 0, stdout: "PATH=/bin\nSHIPYARD_PROBE.DOTTED.NAME=probe-ok\n", stderr: "" };
const dropped = { exitCode: 0, stdout: "PATH=/bin\n", stderr: "" };

beforeEach(() => vi.clearAllMocks());

describe("dotted env var preflight (item 8)", () => {
  it("probes /bin/sh -c env with a dummy dotted variable and no secret", async () => {
    vi.mocked(exec).mockResolvedValue(ok);
    expect(await shellKeepsDottedEnv()).toBe(true);
    const [cmd, args, o] = vi.mocked(exec).mock.calls[0];
    expect(cmd).toBe("/bin/sh");
    expect(args).toEqual(["-c", "env"]);
    expect(Object.keys(o!.env!)).toEqual(["SHIPYARD_PROBE.DOTTED.NAME"]);
  });

  it("fails with a clear error when the shell drops the variable", async () => {
    vi.mocked(exec).mockResolvedValue(dropped);
    await expect(assertShellKeepsDottedEnv()).rejects.toMatchObject({
      code: "SHELL_DROPS_DOTTED_ENV",
      fix: expect.stringContaining("/bin/sh"),
    });
  });

  it("fails when the probe cannot run", async () => {
    vi.mocked(exec).mockRejectedValue(new Error("ENOENT"));
    expect(await shellKeepsDottedEnv()).toBe(false);
  });

  it("doctor check reports pass and fail", async () => {
    const run = async () =>
      (await runRequirementChecks({ projectDir: "/nonexistent", platforms: ["android"], actions: ["build-android"], env: {} })).checks.find(
        (c) => c.id === "sh-env"
      )!;
    vi.mocked(exec).mockResolvedValue(ok);
    expect((await run()).status).toBe("pass");
    vi.mocked(exec).mockResolvedValue(dropped);
    const bad = await run();
    expect(bad.status).toBe("fail");
    expect(bad.fix).toContain("/bin/sh");
  });

  it("the real /bin/sh on this machine keeps dotted names", async () => {
    const actual = await vi.importActual<typeof import("../../src/utils/shell.js")>("../../src/utils/shell.js");
    vi.mocked(exec).mockImplementation(actual.exec);
    expect(await shellKeepsDottedEnv()).toBe(true);
  });
});

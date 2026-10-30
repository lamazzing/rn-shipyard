import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/shell.js")>("../../src/utils/shell.js");
  return { ...actual, exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })) };
});
import { exec } from "../../src/utils/shell.js";
import { setupMatch } from "../../src/platforms/ios/signing.js";

const base = { gitUrl: "g", teamId: "T", bundleId: "b", password: "p", projectDir: "/p", stream: true };
beforeEach(() => vi.clearAllMocks());

describe("init's fastlane match", () => {
  it("interactive: runs in the foreground (Apple ID, 2FA, git prompts on the real terminal)", async () => {
    await setupMatch({ ...base, interactive: true });
    const opts = vi.mocked(exec).mock.calls[0][2]!;
    expect(opts.foreground).toBe(true);
    expect(opts.detached).toBe(false);
    expect(opts).not.toHaveProperty("interactive");
    expect(opts.env).not.toHaveProperty("GIT_TERMINAL_PROMPT");
  });
  it("non-interactive: piped, detached (no controlling terminal) and ssh BatchMode, so /dev/tty prompts cannot hang", async () => {
    await setupMatch({ ...base, interactive: false });
    const call = vi.mocked(exec).mock.calls.find((c) => c[0] === "fastlane")!;
    const opts = call[2]!;
    expect(opts.foreground).toBe(false);
    expect(opts.detached).toBe(true);
    expect(opts.env).toMatchObject({
      MATCH_GIT_URL: "g",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "true",
      SSH_ASKPASS_REQUIRE: "never",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15",
    });
  });
  it("non-interactive: the user's ssh command (core.sshCommand) is kept as the base", async () => {
    vi.mocked(exec).mockImplementation((async (_c: string, args: string[]) =>
      args[0] === "config" ? { exitCode: 0, stdout: "ssh -i /my/key\n", stderr: "" } : { exitCode: 0, stdout: "", stderr: "" }) as never);
    const saved = process.env.GIT_SSH_COMMAND;
    delete process.env.GIT_SSH_COMMAND;
    try {
      await setupMatch({ ...base, interactive: false });
    } finally {
      if (saved !== undefined) process.env.GIT_SSH_COMMAND = saved;
    }
    const call = vi.mocked(exec).mock.calls.find((c) => c[0] === "fastlane")!;
    expect(call[2]!.env!.GIT_SSH_COMMAND).toBe("ssh -i /my/key -o BatchMode=yes -o ConnectTimeout=15");
  });
});

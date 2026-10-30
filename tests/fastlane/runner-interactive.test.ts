import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/shell.js")>("../../src/utils/shell.js");
  return { ...actual, exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })) };
});
import { exec } from "../../src/utils/shell.js";
import { runFastlane } from "../../src/fastlane/runner.js";

beforeEach(() => vi.clearAllMocks());

describe("runFastlane is always phase 2 (piped, never foreground)", () => {
  it("runs detached and streamed, with no foreground/interactive option", async () => {
    await runFastlane("ios", "build", {}, { json: false });
    const opts = vi.mocked(exec).mock.calls[0][2] as Record<string, unknown>;
    expect(opts).toMatchObject({ stream: true, detached: true });
    expect(opts).not.toHaveProperty("foreground");
    expect(opts).not.toHaveProperty("interactive");
  });
});

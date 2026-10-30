import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));
import { exec } from "../../src/utils/shell.js";
import { nativeDirState } from "../../src/utils/native-dirs.js";

let dir: string;
beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), "shipyard-nd-"));
});

function git(tracked: string, ignoredExit: number) {
  vi.mocked(exec).mockImplementation((async (_c: string, a: string[]) => {
    if (a[0] === "rev-parse") return { exitCode: 0, stdout: "true", stderr: "" };
    if (a[0] === "ls-files") return { exitCode: 0, stdout: tracked, stderr: "" };
    return { exitCode: ignoredExit, stdout: "", stderr: "" };
  }) as never);
}

describe("nativeDirState", () => {
  it("absent", async () => {
    expect(await nativeDirState(dir, "ios")).toBe("absent");
  });
  it("tracked wins over ignored", async () => {
    await mkdir(join(dir, "ios"));
    git("ios/a", 0);
    expect(await nativeDirState(dir, "ios")).toBe("tracked");
  });
  it("untracked and git-ignored: ignored (prebuild may regenerate)", async () => {
    await mkdir(join(dir, "ios"));
    git("", 0);
    expect(await nativeDirState(dir, "ios")).toBe("ignored");
  });
  it("untracked and not ignored: untracked (refused)", async () => {
    await mkdir(join(dir, "ios"));
    git("", 1);
    expect(await nativeDirState(dir, "ios")).toBe("untracked");
    expect(vi.mocked(exec).mock.calls.at(-1)?.[1]).toEqual(["check-ignore", "-q", "--", "ios"]);
  });
  it("not a git repo", async () => {
    await mkdir(join(dir, "ios"));
    vi.mocked(exec).mockResolvedValue({ exitCode: 128, stdout: "", stderr: "" });
    expect(await nativeDirState(dir, "ios")).toBe("not-git");
  });
});

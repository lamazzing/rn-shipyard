import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { hasMatchPasswordInKeychain, storeMatchPasswordInKeychain, matchKeychainServer } from "../../src/platforms/ios/match-keychain.js";

const URL = "git@github.com:me/certs.git";

beforeEach(() => vi.clearAllMocks());

describe("match keychain item", () => {
  it("uses the server name fastlane match reads: match_<git url>", () => {
    expect(matchKeychainServer(URL)).toBe("match_git@github.com:me/certs.git");
  });

  it("lookup uses the exit code only (no -w / -g)", async () => {
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 0, stdout: "attributes only", stderr: "" });
    expect(await hasMatchPasswordInKeychain(URL)).toBe(true);
    expect(vi.mocked(exec).mock.calls[0]).toEqual(["security", ["find-internet-password", "-s", "match_git@github.com:me/certs.git"]]);
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 44, stdout: "", stderr: "" });
    expect(await hasMatchPasswordInKeychain(URL)).toBe(false);
  });

  it("no security binary or an empty URL: not found, no throw", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new Error("spawn security ENOENT"));
    expect(await hasMatchPasswordInKeychain(URL)).toBe(false);
    expect(await hasMatchPasswordInKeychain("")).toBe(false);
  });

  it("a URL with credentials never reaches argv", async () => {
    expect(await hasMatchPasswordInKeychain("https://user:tok3n@github.com/me/certs.git")).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it("store: -w is the last argument, foreground, no secret anywhere", async () => {
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    expect(await storeMatchPasswordInKeychain(URL)).toEqual({ success: true });
    const [cmd, args, opts] = vi.mocked(exec).mock.calls[0];
    expect(cmd).toBe("security");
    expect(args).toEqual(["add-internet-password", "-a", "", "-s", "match_git@github.com:me/certs.git", "-U", "-w"]);
    expect(args[args.length - 1]).toBe("-w");
    expect(opts).toMatchObject({ foreground: true });
  });

  it("store: a non-zero exit is reported, not thrown", async () => {
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" });
    expect(await storeMatchPasswordInKeychain(URL)).toMatchObject({ success: false });
  });
});

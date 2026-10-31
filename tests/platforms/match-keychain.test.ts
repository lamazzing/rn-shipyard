import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { hasMatchPasswordInKeychain, storeMatchPasswordInKeychain, storeMatchPasswordValueInKeychain, matchKeychainServer } from "../../src/platforms/ios/match-keychain.js";

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

  it("store a known value: `security -i` reads the command on stdin, the password is not in argv, -w is last", async () => {
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    expect(await storeMatchPasswordValueInKeychain(URL, 's3cret "q" \\')).toEqual({ success: true });
    const [cmd, args, opts] = vi.mocked(exec).mock.calls[0];
    expect(cmd).toBe("security");
    expect(args).toEqual(["-i"]);
    expect(opts).toMatchObject({
      input: 'add-internet-password -a "" -s "match_git@github.com:me/certs.git" -U -w "s3cret \\"q\\" \\\\"\n',
      redact: ['s3cret "q" \\'],
    });
    expect(opts).not.toHaveProperty("foreground");
  });

  it("store a known value: refuses an empty password and line breaks (they would start a second command)", async () => {
    expect(await storeMatchPasswordValueInKeychain(URL, "")).toMatchObject({ success: false });
    expect(await storeMatchPasswordValueInKeychain(URL, "a\nadd-generic-password -s x")).toMatchObject({ success: false });
    expect(await storeMatchPasswordValueInKeychain("https://u:tok@github.com/me/c.git", "pw")).toMatchObject({ success: false });
    expect(exec).not.toHaveBeenCalled();
  });

  it("store a known value: a failure names the exit code, never the password", async () => {
    vi.mocked(exec).mockResolvedValueOnce({ exitCode: 36, stdout: "", stderr: "pw-shown" });
    const r = await storeMatchPasswordValueInKeychain(URL, "pw-shown");
    expect(r).toEqual({ success: false, error: "security exited with code 36" });
    vi.mocked(exec).mockRejectedValueOnce(new Error("spawn failed for pw-shown"));
    expect((await storeMatchPasswordValueInKeychain(URL, "pw-shown")).error).not.toContain("pw-shown");
  });
});

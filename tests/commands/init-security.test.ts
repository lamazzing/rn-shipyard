import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, realpath, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShipyardError } from "../../src/utils/errors.js";

vi.mock("../../src/platforms/android/keystore.js", () => ({ generateKeystore: vi.fn() }));
vi.mock("../../src/platforms/ios/signing.js", () => ({ setupMatch: vi.fn() }));
vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn(), registerStdinReleaser: vi.fn(() => () => {}) }));
const prompter = { ask: vi.fn(), askSecret: vi.fn(), close: vi.fn() };
vi.mock("../../src/utils/prompt.js", () => ({ createPrompter: vi.fn(() => prompter) }));

import { generateKeystore } from "../../src/platforms/android/keystore.js";
import { setupMatch } from "../../src/platforms/ios/signing.js";
import { exec } from "../../src/utils/shell.js";
import initCmd, { type InitOptions } from "../../src/commands/init.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

const TOKEN_URL = "https://x-access-token:ghp_SECRETTOKEN123@github.com/org/certs.git";
const ENV_KEYS = ["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_PASSWORD", "MATCH_GIT_URL", "MATCH_PASSWORD", "APPLE_TEAM_ID"];

let dir: string;
let cwd: string;
let out: string[];
let saved: Record<string, string | undefined>;
let ttyStdin: PropertyDescriptor | undefined;
let ttyStdout: PropertyDescriptor | undefined;

async function run(extra: Partial<InitOptions> = {}): Promise<{ code: number; json: any; raw: string }> {
  let code = 0;
  try {
    await initCmd({ platform: "android", json: true, nonInteractive: false, ...extra });
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
    code = e.code;
  }
  const raw = out.join("\n");
  return { code, json: raw && extra.json !== false ? JSON.parse(raw) : undefined, raw };
}

const exists = (p: string) => access(p).then(() => true, () => false);
const setTty = (v: boolean) => {
  Object.defineProperty(process.stdin, "isTTY", { value: v, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: v, configurable: true });
};

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-initsec-")));
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({
      expo: {
        name: "App",
        slug: "app",
        version: "1.0.0",
        ios: { bundleIdentifier: "com.x.app" },
        android: { package: "com.x.app" },
      },
    })
  );
  process.chdir(dir);
  out = [];
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  ttyStdin = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  ttyStdout = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  vi.mocked(generateKeystore).mockResolvedValue({ created: true } as never);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  if (ttyStdin) Object.defineProperty(process.stdin, "isTTY", ttyStdin);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  if (ttyStdout) Object.defineProperty(process.stdout, "isTTY", ttyStdout);
  else delete (process.stdout as { isTTY?: boolean }).isTTY;
});

describe("init --json without --non-interactive", () => {
  it("never prompts and fails with a JSON error when a value is missing", async () => {
    setTty(true); // even on a terminal, --json means no prompts
    const { code, json } = await run();
    expect(code).toBe(2);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("MISSING_CONFIG_ANDROID");
    expect(prompter.ask).not.toHaveBeenCalled();
    expect(prompter.askSecret).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });

  it("succeeds with env values and prints one JSON document", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "hunter22-secret";
    const { code, json, raw } = await run();
    expect(code).toBe(0);
    expect(json.success).toBe(true);
    expect(raw).not.toContain("hunter22");
    expect(out).toHaveLength(1);
  });

  it("treats a non-TTY stdin as non-interactive even without --json", async () => {
    setTty(false);
    const { code } = await run({ json: false });
    expect(code).toBe(2);
    expect(prompter.askSecret).not.toHaveBeenCalled();
  });
});

describe("init --json warnings (item 8)", () => {
  it("includes logger warnings (MATCH_PASSWORD missing, alias assumption) like build does", async () => {
    process.env.APPLE_TEAM_ID = "TEAM";
    process.env.MATCH_GIT_URL = "git@github.com:o/r.git";
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    try {
      const { code, json } = await run({ platform: "ios" });
      expect(code).toBe(0);
      expect(json.warnings).toEqual(expect.arrayContaining([expect.stringContaining("MATCH_PASSWORD not set")]));
    } finally {
      delete process.env.APPLE_TEAM_ID;
    }
  });

  it("includes 'Match setup failed'", async () => {
    process.env.APPLE_TEAM_ID = "TEAM";
    process.env.MATCH_GIT_URL = "git@github.com:o/r.git";
    process.env.MATCH_PASSWORD = "mpw";
    vi.mocked(setupMatch).mockResolvedValue({ success: false, error: "nope" });
    try {
      const { json } = await run({ platform: "ios" });
      expect(json.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Match setup failed")]));
      expect(vi.mocked(setupMatch).mock.calls[0][0]).toMatchObject({ interactive: false });
    } finally {
      delete process.env.APPLE_TEAM_ID;
    }
  });
});

describe("init interactive input failures", () => {
  it("stdin closed mid-prompt exits 1 with a JSON-shaped error (never 0)", async () => {
    setTty(true);
    prompter.ask.mockRejectedValue(
      new ShipyardError("INPUT_CLOSED", "Input ended before all questions were answered", "use --non-interactive")
    );
    const { code, json } = await run({ platform: "ios", json: false });
    expect(code).toBe(1);
    expect(json).toBeUndefined(); // human mode: no JSON, message on stderr/log
    expect(await exists(join(dir, ".shipyard", "config.json"))).toBe(false);
    expect(prompter.close).toHaveBeenCalled();
  });

  it("interactive Android uses askSecret and passes the env value only as a hidden fallback", async () => {
    setTty(true);
    process.env.ANDROID_KEYSTORE_PASSWORD = "hunter22-secret";
    prompter.askSecret.mockImplementation(async (_q: string, fallback?: string) => fallback ?? "");
    const { code } = await run({ json: false });
    expect(code).toBe(0);
    expect(prompter.askSecret).toHaveBeenCalledWith("Keystore password", "hunter22-secret");
    expect(prompter.ask).not.toHaveBeenCalled();
    const text = JSON.stringify(out);
    expect(text).not.toContain("hunter22");
  });

  it("asks twice for a newly typed keystore password and rejects a mismatch", async () => {
    setTty(true);
    prompter.askSecret.mockResolvedValueOnce("abcdef1").mockResolvedValueOnce("different");
    prompter.askSecret.mockResolvedValue("");
    const { code, json } = await run({ json: false });
    expect(code).toBe(1);
    expect(json).toBeUndefined();
    expect(generateKeystore).not.toHaveBeenCalled();
  });
});

describe("init keystore password policy", () => {
  it("rejects a password shorter than 6 characters before calling keytool", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "abc";
    const { code, json } = await run();
    expect(code).toBe(1);
    expect(json.error.code).toBe("INVALID_KEYSTORE_PASSWORD");
    expect(JSON.stringify(json)).not.toContain('"abc"');
    expect(generateKeystore).not.toHaveBeenCalled();
  });

  it("surfaces a keystore generation failure as a JSON error", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    vi.mocked(generateKeystore).mockRejectedValue(
      new ShipyardError("KEYSTORE_GENERATION_FAILED", "Keystore generation failed (keytool exit 1)", "fix")
    );
    const { code, json } = await run();
    expect(code).toBe(1);
    expect(json.success).toBe(false);
    expect(json.error).toEqual({ code: "KEYSTORE_GENERATION_FAILED", message: expect.any(String), fix: "fix" });
  });

  it("converts an unexpected exception to one JSON envelope with secrets redacted", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    vi.mocked(generateKeystore).mockRejectedValue(new Error("boom password1"));
    const { code, json, raw } = await run();
    expect(code).toBe(1);
    expect(json.error.code).toBe("INIT_FAILED");
    expect(raw).not.toContain("password1");
  });
});

describe("init Match git URL credentials", () => {
  beforeEach(() => {
    process.env.APPLE_TEAM_ID = "ABC123DEF4";
  });

  const nothingWritten = async () => {
    expect(await exists(join(dir, ".shipyard"))).toBe(false);
    expect(await exists(join(dir, "fastlane"))).toBe(false);
    expect(setupMatch).not.toHaveBeenCalled();
  };

  it("rejects a token-bearing URL from the environment", async () => {
    process.env.MATCH_GIT_URL = TOKEN_URL;
    const { code, json, raw } = await run({ platform: "ios" });
    expect(code).toBe(1);
    expect(json.error.code).toBe("INVALID_MATCH_GIT_URL");
    expect(json.error.fix).toContain("MATCH_GIT_BASIC_AUTHORIZATION");
    expect(raw).not.toContain("ghp_SECRETTOKEN123");
    await nothingWritten();
  });

  it("rejects user:password and token-as-username https URLs", async () => {
    for (const url of ["https://user:pw@github.com/o/r.git", "https://ghp_abc@github.com/o/r.git"]) {
      process.env.MATCH_GIT_URL = url;
      out = [];
      const { code, json } = await run({ platform: "ios" });
      expect(code).toBe(1);
      expect(json.error.code).toBe("INVALID_MATCH_GIT_URL");
    }
    await nothingWritten();
  });

  it("rejects a token-bearing URL typed at the prompt", async () => {
    setTty(true);
    prompter.ask.mockImplementation(async (q: string, d?: string) =>
      q.startsWith("Match Git URL") ? TOKEN_URL : d ?? ""
    );
    const { code, json } = await run({ platform: "ios", json: false });
    expect(code).toBe(1);
    expect(json).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("ghp_SECRETTOKEN123");
    await nothingWritten();
  });

  it("accepts SSH and clean https URLs, and writes them as given", async () => {
    for (const url of ["git@github.com:org/certs.git", "ssh://git@github.com/org/certs.git", "https://github.com/org/certs.git"]) {
      process.env.MATCH_GIT_URL = url;
      out = [];
      const { code } = await run({ platform: "ios" });
      expect(code).toBe(0);
      const cfg = JSON.parse(await readFile(join(dir, ".shipyard", "config.json"), "utf-8"));
      expect(cfg.platforms.ios.matchGitUrl).toBe(url);
    }
  });
});

describe("init .gitignore merge", () => {
  it("compares whole lines: google-credentials.json does not cover credentials.json", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    await writeFile(join(dir, ".gitignore"), "google-credentials.json\n*.jks.bak\n");
    const { code } = await run();
    expect(code).toBe(0);
    const gi = (await readFile(join(dir, ".gitignore"), "utf-8")).split("\n");
    expect(gi.filter((l) => l === "credentials.json")).toHaveLength(1);
    expect(gi.filter((l) => l === "*.jks")).toHaveLength(1);
    expect(gi.filter((l) => l === "google-credentials.json")).toHaveLength(1);
  });

  it("does not duplicate lines that are already present", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    await run();
    const first = await readFile(join(dir, ".gitignore"), "utf-8");
    out = [];
    await run();
    expect(await readFile(join(dir, ".gitignore"), "utf-8")).toBe(first);
  });
});

describe("init credentials file in the repository", () => {
  async function withCreds() {
    await writeFile(join(dir, "up.jks"), "x");
    await writeFile(join(dir, "creds.json"), JSON.stringify({ keystorePassword: "password1", keyAlias: "a" }));
  }

  it("warns in the JSON output when the file is inside the repo and not ignored", async () => {
    await withCreds();
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    const { code, json } = await run({ androidKeystore: join(dir, "up.jks"), androidCredentials: join(dir, "creds.json") });
    expect(code).toBe(0);
    const credWarnings = json.warnings.filter((w: string) => w.includes("creds.json"));
    expect(credWarnings).toHaveLength(1);
    expect(credWarnings[0]).toContain(".gitignore");
    expect(vi.mocked(exec).mock.calls[0].slice(0, 2)).toEqual(["git", ["check-ignore", "-q", "--", "creds.json"]]);
  });

  it("is silent when the file is ignored, or this is not a git repo", async () => {
    await withCreds();
    for (const exitCode of [0, 128]) {
      out = [];
      vi.mocked(exec).mockResolvedValue({ exitCode, stdout: "", stderr: "" });
      const { code, json } = await run({ androidKeystore: join(dir, "up.jks"), androidCredentials: join(dir, "creds.json") });
      expect(code).toBe(0);
      expect((json.warnings ?? []).filter((w: string) => w.includes("creds.json"))).toEqual([]);
    }
  });

  it("does not check a credentials file outside the project", async () => {
    const other = await realpath(await mkdtemp(join(tmpdir(), "shipyard-outside-")));
    await writeFile(join(dir, "up.jks"), "x");
    await writeFile(join(other, "creds.json"), JSON.stringify({ keystorePassword: "password1", keyAlias: "a" }));
    const { code } = await run({ androidKeystore: join(dir, "up.jks"), androidCredentials: join(other, "creds.json") });
    expect(code).toBe(0);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("init portable paths", () => {
  it("stores and prints an absolute serviceAccountKeyPath under home as ~/...", async () => {
    process.env.ANDROID_KEYSTORE_PASSWORD = "password1";
    const { homedir } = await import("node:os");
    await writeFile(
      join(dir, "eas.json"),
      JSON.stringify({ build: {}, submit: { production: { android: { serviceAccountKeyPath: join(homedir(), "keys", "play.json") } } } })
    );
    await mkdir(join(dir, ".shipyard"), { recursive: true });
    const { code, json } = await run();
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, ".shipyard", "config.json"), "utf-8"));
    expect(cfg.platforms.android.serviceAccountKeyPath).toBe("~/keys/play.json");
    expect(json.config.platforms.android.serviceAccountKeyPath).toBe("~/keys/play.json");
  });
});

import { describe, it, expect } from "vitest";
import { redactSecrets, createStreamRedactor } from "../../src/utils/shell.js";
import { collectSecrets, gitUrlSecrets, SECRET_ENV_VARS } from "../../src/utils/secrets.js";

describe("collected secrets (item 7)", () => {
  it("includes MATCH_KEYCHAIN_PASSWORD and MATCH_GIT_BEARER_AUTHORIZATION", () => {
    expect(SECRET_ENV_VARS).toContain("MATCH_KEYCHAIN_PASSWORD");
    expect(SECRET_ENV_VARS).toContain("MATCH_GIT_BEARER_AUTHORIZATION");
    const s = collectSecrets({ MATCH_KEYCHAIN_PASSWORD: "kc-pass-1", MATCH_GIT_BEARER_AUTHORIZATION: "Bearer tok-abc-123" });
    expect(s).toEqual(expect.arrayContaining(["kc-pass-1", "tok-abc-123", "Bearer tok-abc-123"]));
  });

  it("takes the password and user:pass of MATCH_GIT_URL, not the URL itself", () => {
    const s = collectSecrets({ MATCH_GIT_URL: "https://bob:p%40ss@github.com/org/certs.git" });
    expect(s).toEqual(expect.arrayContaining(["p%40ss", "p@ss", "bob:p%40ss", "bob:p@ss"]));
    expect(s.some((x) => x.includes("github.com"))).toBe(false);
    const out = redactSecrets("cloning https://bob:p%40ss@github.com/org/certs.git as bob:p@ss", s);
    expect(out).not.toContain("p%40ss");
    expect(out).not.toContain("p@ss");
    expect(out).toContain("github.com/org/certs.git");
  });

  it("treats the user part of an https URL as a token, but not an ssh user", () => {
    expect(gitUrlSecrets("https://ghp_TOKEN123@github.com/o/r.git")).toContain("ghp_TOKEN123");
    expect(gitUrlSecrets("ssh://git@github.com/o/r.git")).toEqual([]);
    expect(gitUrlSecrets("git@github.com:o/r.git")).toEqual([]);
    expect(gitUrlSecrets(undefined)).toEqual([]);
  });
});

describe("redaction variants", () => {
  it("URL-encoded form", () => {
    const secret = "pa ss/w@rd&1";
    const out = redactSecrets(`url=https://x/?p=${encodeURIComponent(secret)} end`, [secret]);
    expect(out).toBe("url=https://x/?p=*** end");
  });

  it("Ruby inspect form, with \\#{ escaping", () => {
    const secret = 'ab#{c}d"e\\f';
    const inspected = 'ab\\#{c}d\\"e\\\\f'; // "ab\#{c}d\"e\\f".inspect body
    const out = redactSecrets(`got "${inspected}" and raw ${secret}`, [secret]);
    expect(out).not.toContain("c}d");
    expect(out).toBe('got "***" and raw ***');
  });

  it("Unicode NFC and NFD forms", () => {
    const nfc = "café-süper";
    const nfd = nfc.normalize("NFD");
    expect(nfc).not.toBe(nfd);
    for (const text of [nfc, nfd]) {
      expect(redactSecrets(`x ${text} y`, [nfc])).toBe("x *** y");
      expect(redactSecrets(`x ${text} y`, [nfd])).toBe("x *** y");
    }
  });

  it("overlapping secrets are masked once, with no leaked fragment", () => {
    // 'abcdef' and 'cdefgh' overlap in the text 'abcdefgh'
    expect(redactSecrets("x abcdefgh y", ["abcdef", "cdefgh"])).toBe("x *** y");
    // contained and adjacent
    expect(redactSecrets("abcdef", ["abc", "def"])).toBe("***");
    expect(redactSecrets("1abcdef2", ["abcd", "bcdef"])).toBe("1***2");
  });

  it("overlap fix also holds in the stream redactor", () => {
    const r = createStreamRedactor(["abcdef", "cdefgh"]);
    const out = r.push("x abcd") + r.push("efgh y\n") + r.flush();
    expect(out).toBe("x *** y\n");
  });

  it("repeated and non-overlapping occurrences each become ***", () => {
    expect(redactSecrets("s1 and s1 and s2", ["s1", "s2"])).toBe("*** and *** and ***");
  });
});

describe("stream redactor: overlapping matches never leak a straddling front part", () => {
  const cases: Array<[string, string[], string]> = [
    ["abcab self-overlap", ["abcab"], "abcabcab"],
    ["abab self-overlap", ["abab"], "ababab"],
    [
      "emoji secrets, JSON form twice",
      ["\\{\u{1F600}\u00e9", "{\u{1F600}\u00e9#\u00e9'\u00e9a\"\\"],
      JSON.stringify("{\u{1F600}\u00e9#\u00e9'\u00e9a\"\\").slice(1, -1).repeat(2),
    ],
  ];
  for (const [name, secrets, input] of cases) {
    const check = (out: string) => {
      expect(out.replace(/\*/g, "")).toBe("");
    };
    it(`${name}: one chunk`, () => {
      const r = createStreamRedactor(secrets);
      check(r.push(input) + r.flush());
    });
    it(`${name}: per character`, () => {
      const r = createStreamRedactor(secrets);
      let out = "";
      for (const ch of input) out += r.push(ch);
      check(out + r.flush());
    });
    it(`${name}: per byte`, () => {
      const r = createStreamRedactor(secrets);
      let out = "";
      for (const b of Buffer.from(input, "utf8")) out += r.push(Buffer.from([b]));
      check(out + r.flush());
    });
  }
});

describe("surrogate pairs and lone surrogates", () => {
  it("shell-escapes an emoji as Ruby Shellwords does (one backslash per code point)", () => {
    expect(redactSecrets("pw=\\\u{1F600}x", ["\u{1F600}x"])).toBe("pw=***");
  });
  it("a lone surrogate secret does not throw and the raw form is still masked", () => {
    expect(() => redactSecrets("a\ud800b", ["\ud800"])).not.toThrow();
    expect(redactSecrets("a\ud800b", ["\ud800"])).toBe("a***b");
  });
});

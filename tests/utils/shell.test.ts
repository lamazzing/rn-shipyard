import { describe, it, expect, vi, afterEach } from "vitest";
import { exec, redactSecrets, createStreamRedactor, secretVariants } from "../../src/utils/shell.js";

// These tests spawn a real, short-lived node child to exercise the real output path.
const node = process.execPath;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((t: string) => (out.push(String(t)), true)) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((t: string) => (err.push(String(t)), true)) as never);
  return { out, err };
}

afterEach(() => vi.restoreAllMocks());

function shellwords(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-.,:+/@\n]/g, "\\$&");
}

describe("exec output redaction (real child process)", () => {
  it("catches a secret split across separate writes, streamed and captured", async () => {
    const { out, err } = capture();
    const script = `
      const w = (s) => new Promise((r) => process.stdout.write(s, r));
      (async () => {
        await w("pass=hun"); await new Promise((r) => setTimeout(r, 60));
        await w("ter22 end\\n");
        process.stderr.write("e=hun"); await new Promise((r) => setTimeout(r, 60));
        process.stderr.write("ter22\\n");
      })();`;
    const r = await exec(node, ["-e", script], { stream: true, redact: ["hunter22"] });
    const all = [r.stdout, r.stderr, ...out, ...err].join("|");
    expect(all).not.toContain("hunter22");
    expect(all).not.toContain("hun|");
    expect(r.stdout).toBe("pass=*** end");
    expect(r.stderr).toBe("e=***");
    expect(out.join("")).toBe("pass=*** end\n");
  });

  it("redacts the unterminated tail on close", async () => {
    const r = await exec(node, ["-e", `process.stdout.write("tail hunter22")`], { redact: ["hunter22"] });
    expect(r.stdout).toBe("tail ***");
  });

  it("redacts shell-escaped, single- and double-quoted forms", async () => {
    const secret = `p@ss w0rd!$"x'y\\z`;
    const forms = [
      secret,
      shellwords(secret),
      `'${secret.replace(/'/g, "'\\''")}'`,
      `"${secret.replace(/[\\"$`]/g, "\\$&")}"`,
    ];
    const { out } = capture();
    const script = `for (const f of ${JSON.stringify(forms)}) process.stdout.write("cmd " + f + " done\\n");`;
    const r = await exec(node, ["-e", script], { stream: true, redact: [secret] });
    expect(r.stdout.split("\n")).toEqual(Array(forms.length).fill("cmd *** done"));
    expect(out.join("")).not.toMatch(/w0rd|w\\0rd/);
  });

  it("redacts short secrets, longest first so overlaps leave no fragments", async () => {
    const r = await exec(node, ["-e", `console.log("a=ab abc xyz1 b")`], { redact: ["ab", "abc", "b", "xyz1"] });
    expect(r.stdout).toBe("a=*** *** *** ***");
    expect(r.stdout).not.toMatch(/[bc]/);
  });

  it("redacts a secret split inside a multi-byte-free long unterminated tail", async () => {
    const secret = "S3cr3t!";
    const script = `process.stdout.write("x".repeat(20000) + "${secret.slice(0, 3)}"); setTimeout(() => process.stdout.write("${secret.slice(3)}y"), 80);`;
    const r = await exec(node, ["-e", script], { redact: [secret] });
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout.endsWith("***y")).toBe(true);
  });

  it("passes output through unchanged without secrets", async () => {
    const r = await exec(node, ["-e", `process.stdout.write("hello\\nworld")`]);
    expect(r.stdout).toBe("hello\nworld");
  });
});

describe("exec redaction across an idle pause", () => {
  it("does not leak a secret printed with a >150ms pause mid-secret", async () => {
    capture();
    for (const split of [1, 2, 3, 5]) {
      const script = `
        const s = process.env.MATCH_PASSWORD;
        const k = ${split};
        process.stdout.write("token: " + s.slice(0, k));
        setTimeout(() => process.stdout.write(s.slice(k) + " done\\n"), 400);
      `;
      const r = await exec(node, ["-e", script], { env: { MATCH_PASSWORD: "hunter2xyz" }, stream: true });
      expect(r.stdout, `split ${split}`).toBe("token: *** done");
    }
  });
});

describe("redactSecrets / createStreamRedactor", () => {
  it("ignores empty secrets and handles a 1-char secret", () => {
    expect(redactSecrets("abc", ["", "b"])).toBe("a***c");
  });

  it("emits a prompt without a trailing newline immediately", () => {
    const r = createStreamRedactor(["secret"]);
    expect(r.push("Please enter the 6 digit code: ")).toBe("Please enter the 6 digit code: ");
    expect(r.hasHeld()).toBe(false);
  });

  it("holds back only the suffix that could still become a secret", () => {
    const r = createStreamRedactor(["secret"]);
    expect(r.push("a sec")).toBe("a ");
    expect(r.hasHeld()).toBe(true);
    expect(r.push("ret b\nnext sec")).toBe("*** b\nnext ");
    expect(r.flush()).toBe("***");
  });

  it("masks an unfinished secret prefix left at end of stream", () => {
    const r = createStreamRedactor(["hunter2xyz"]);
    expect(r.push("pw: hunter") + r.flush()).toBe("pw: ***");
  });

  it("does not add a second mask when the end-of-stream prefix continues a drained carry", () => {
    const r = createStreamRedactor(["hunter2xyz"]);
    expect(r.push("pw: hun") + r.drainHeld() + r.push("ter") + r.flush()).toBe("pw: ***");
  });

  it("catches a secret arriving one character per write", () => {
    const r = createStreamRedactor(["hunter22"]);
    let out = "";
    for (const ch of "pw=hunter22 ok") out += r.push(ch);
    out += r.flush();
    expect(out).toBe("pw=*** ok");
    expect(out).not.toContain("hunter");
  });

  it("masks a held partial secret on drainHeld (idle timeout)", () => {
    const r = createStreamRedactor(["secret"]);
    expect(r.push("code: sec")).toBe("code: ");
    expect(r.drainHeld()).toBe("***");
    expect(r.hasHeld()).toBe(false);
  });

  it("masks even a short (1-2 char) hold on drainHeld, and does not leak the continuation", () => {
    const r = createStreamRedactor(["secret"]);
    expect(r.push("enter code: se")).toBe("enter code: ");
    expect(r.drainHeld()).toBe("***");
    expect(r.push("cret done")).toBe(" done");
    expect(r.flush()).toBe("");
  });

  describe("pause mid-secret (prefix, idle drain, rest)", () => {
    const secret = 'p@ss w"rd$x';
    const variants = secretVariants([secret]);
    const pairs = (v: string) => Array.from({ length: v.length - 1 }, (_, i) => v.slice(i, i + 2));

    for (const [name, form] of [
      ["raw", secret],
      ["shell-escaped", variants.find((v) => v.includes("\\ ")) ?? secret],
      ["quoted", variants.find((v) => v.startsWith("'")) ?? secret],
      ["url-encoded", encodeURIComponent(secret)],
      ["json", JSON.stringify(secret).slice(1, -1)],
    ] as const) {
      it(`never leaks any part of the ${name} form at any split point`, () => {
        expect(variants).toContain(form);
        for (let k = 1; k < form.length; k++) {
          const r = createStreamRedactor([secret]);
          let out = r.push("<<" + form.slice(0, k));
          out += r.drainHeld();
          out += r.push(form.slice(k) + ">>");
          out += r.flush();
          expect(out, `split ${k}`).toBe("<<***>>");
          for (const v of variants) for (const p of pairs(v)) expect(out).not.toContain(p);
        }
      });
    }

    it("handles several pauses inside one secret with a single ***", () => {
      const r = createStreamRedactor(["hunter2xyz"]);
      let out = r.push("A=hu") + r.drainHeld();
      out += r.push("nte") + r.drainHeld();
      out += r.push("r2xyz END") + r.flush();
      expect(out).toBe("A=*** END");
    });

    it("emits the continuation normally when it refutes the prefix", () => {
      const r = createStreamRedactor(["secret"]);
      let out = r.push("A=sec") + r.drainHeld();
      out += r.push("ond") + r.flush();
      expect(out).toBe("A=***ond");
    });

    it("keeps masking a second secret that follows the continuation", () => {
      const r = createStreamRedactor(["hunter2xyz"]);
      let out = r.push("hun") + r.drainHeld();
      out += r.push("ter2xyz hunter2xyz!") + r.flush();
      expect(out).toBe("*** ***!");
    });

    it("bounds the carry and clears it once no variant can span it", () => {
      const r = createStreamRedactor(["abcdef"]);
      let out = r.push("abcde") + r.drainHeld();
      out += r.push("zzzzzzzz") + r.push("f") + r.flush();
      expect(out).toBe("***zzzzzzzzf");
    });
  });

  it("never splits a secret that overlaps a shorter secret's prefix", () => {
    const r = createStreamRedactor(["abcab", "ab"]);
    expect(r.push("xabcab") + r.flush()).toBe("x***");
  });
});

describe("empty MATCH_PASSWORD", () => {
  it("is removed from the child environment (Ruby would read \"\" as a passphrase), a real one is kept", async () => {
    const probe = 'process.stdout.write(JSON.stringify({ has: "MATCH_PASSWORD" in process.env }))';
    const empty = await exec(node, ["-e", probe], { env: { MATCH_PASSWORD: "" } });
    expect(JSON.parse(empty.stdout)).toEqual({ has: false });
    const real = await exec(node, ["-e", probe], { env: { MATCH_PASSWORD: "s3cretpw" } });
    expect(JSON.parse(real.stdout).has).toBe(true);
  });
});

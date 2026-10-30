import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFdSync } from "../../src/utils/terminal.js";

describe("writeFdSync", () => {
  it("writes everything across partial writes and retries EAGAIN", () => {
    const got: Buffer[] = [];
    let calls = 0;
    const ok = writeFdSync(1, "héllo wörld, partial", (_fd, buf, off, len) => {
      calls++;
      if (calls % 3 === 1) throw Object.assign(new Error("again"), { code: "EAGAIN" });
      const n = Math.min(4, len);
      got.push(Buffer.from(buf.subarray(off, off + n)));
      return n;
    });
    expect(ok).toBe(true);
    expect(Buffer.concat(got).toString("utf8")).toBe("héllo wörld, partial");
  });

  it("a write that returns 0 without throwing is bounded, not an infinite loop", () => {
    let calls = 0;
    const ok = writeFdSync(1, "x", () => {
      calls++;
      return 0;
    });
    expect(ok).toBe(false);
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(10_000);
  });

  it("gives up silently on EPIPE and never throws", () => {
    const ok = writeFdSync(1, "x", () => {
      throw Object.assign(new Error("broken"), { code: "EPIPE" });
    });
    expect(ok).toBe(false);
  });

  it("delivers a large payload intact to a slow reader through a real non-blocking pipe", async () => {
    const payload = JSON.stringify({ success: true, blob: "x".repeat(3_000_000) }, null, 2) + "\n";
    const reader = `
      const h = require("node:crypto").createHash("sha256"); let n = 0;
      setTimeout(() => {
        process.stdin.on("data", (d) => { h.update(d); n += d.length; });
        process.stdin.on("end", () => console.log(n + " " + h.digest("hex")));
      }, 400);
    `;
    const child = spawn(process.execPath, ["-e", reader], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const done = new Promise<void>((r) => child.on("close", () => r()));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fd: number = (child.stdin as any)._handle.fd;
    expect(typeof fd).toBe("number");
    expect(writeFdSync(fd, payload)).toBe(true); // blocks until the slow reader drained the pipe
    child.stdin.end();
    await done;
    const [n, hash] = out.trim().split(" ");
    expect(Number(n)).toBe(Buffer.byteLength(payload));
    expect(hash).toBe(createHash("sha256").update(payload).digest("hex"));
  });
});

import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { createPrompter } from "../../src/utils/prompt.js";

function setup(terminal: boolean) {
  const input = new PassThrough();
  let written = "";
  const output = new Writable({
    write(chunk, _e, cb) {
      written += chunk.toString();
      cb();
    },
  });
  const prompter = createPrompter({ input, output, terminal });
  return { input, prompter, out: () => written };
}

describe("prompter", () => {
  it("plain ask shows the default and returns it on empty input", async () => {
    const { input, prompter, out } = setup(false);
    const p = prompter.ask("init.ios.team-id", "Team ID", "ABC123");
    input.write("\n");
    expect(await p).toBe("ABC123");
    expect(out()).toContain("Team ID [ABC123]");
    prompter.close();
  });

  it("secret prompt never prints the env fallback", async () => {
    const { input, prompter, out } = setup(true);
    const p = prompter.askSecret("init.android.keystore-password", "Keystore password", "hunter22-secret");
    input.write("\r");
    expect(await p).toBe("hunter22-secret");
    expect(out()).toContain("[from env]");
    expect(out()).not.toContain("hunter22");
    prompter.close();
  });

  it("secret prompt does not echo typed characters (terminal mode)", async () => {
    const { input, prompter, out } = setup(true);
    const p = prompter.askSecret("init.android.keystore-password", "Keystore password");
    input.write("s3cr3t-typed\r");
    expect(await p).toBe("s3cr3t-typed");
    expect(out()).not.toContain("s3cr3t");
    // echo is restored for the next plain question
    const q = prompter.ask("init.ios.team-id", "Name");
    input.write("visible\r");
    expect(await q).toBe("visible");
    expect(out()).toContain("visible");
    prompter.close();
  });

  it("one shared interface reads several piped answers", async () => {
    const { input, prompter } = setup(false);
    input.write("a\nb\n");
    expect(await prompter.ask("init.ios.team-id", "one")).toBe("a");
    expect(await prompter.ask("init.ios.team-id", "two")).toBe("b");
    prompter.close();
  });

  it("rejects with INPUT_CLOSED when stdin ends mid-prompt", async () => {
    const { input, prompter } = setup(false);
    const p = prompter.ask("init.ios.team-id", "Team ID");
    input.end();
    await expect(p).rejects.toMatchObject({ code: "INPUT_CLOSED" });
    await expect(prompter.ask("init.ios.team-id", "again")).rejects.toMatchObject({ code: "INPUT_CLOSED" });
  });

  it("rejects with INTERRUPTED on Ctrl-C", async () => {
    const { input, prompter } = setup(true);
    const p = prompter.askSecret("init.android.keystore-password", "pw");
    input.write("\u0003");
    await expect(p).rejects.toMatchObject({ code: "INTERRUPTED" });
  });
});

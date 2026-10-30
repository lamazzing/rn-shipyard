import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateFastfile, generateAppfile, rubyString } from "../../src/fastlane/generator.js";
import type { ShipyardConfig } from "../../src/core/config.js";

const NASTY = `Bob's "App" #{x}`;
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "shipyard-esc-"));
});

const cfg = (over: { serviceAccountKeyPath?: string; bundleId?: string; alias?: string } = {}): ShipyardConfig => ({
  version: "1.0.0",
  createdAt: "x",
  platforms: {
    ios: { enabled: true, signingMethod: "match", matchGitUrl: "git@h:o/r.git", matchType: "appstore", teamId: "T1", bundleId: over.bundleId ?? "com.x.app" },
    android: { enabled: true, keystorePath: ".shipyard/k.jks", keystoreAlias: over.alias ?? "release", serviceAccountKeyPath: over.serviceAccountKeyPath },
  },
  outputDir: "./output",
});

function rubySyntaxOk(path: string): boolean | undefined {
  try {
    execFileSync("ruby", ["-c", path], { stdio: "pipe" });
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? undefined : false;
  }
}

describe("rubyString", () => {
  it("escapes quotes, backslashes, # and control characters", () => {
    expect(rubyString(NASTY)).toBe(`"Bob's \\"App\\" \\#{x}"`);
    expect(rubyString("a\\b\nc")).toBe('"a\\\\b\\nc"');
    expect(rubyString("#$x #@y")).toBe('"\\#$x \\#@y"');
  });
});

describe("templates with user-controlled values", () => {
  it("Fastfile: app name, alias and bundle id are Ruby-escaped, not HTML-escaped, never interpolated", async () => {
    await generateFastfile(dir, cfg({ alias: NASTY, bundleId: NASTY }), NASTY);
    const content = await readFile(join(dir, "fastlane", "Fastfile"), "utf-8");
    expect(content).not.toContain("&#39;");
    expect(content).not.toContain("&quot;");
    expect(content).not.toMatch(/(?<!\\)#\{/); // no live interpolation
    expect(content).toContain(`"Bob's \\"App\\" \\#{x}.ipa"`);
    expect(content).toContain(`app_identifier: "Bob's \\"App\\" \\#{x}"`);
    expect(content).toContain(`options[:key_alias] || "Bob's \\"App\\" \\#{x}"`);
    const ok = rubySyntaxOk(join(dir, "fastlane", "Fastfile"));
    if (ok !== undefined) expect(ok).toBe(true);
  });

  it("Fastfile: workspace and scheme come from lane options, not the app name", async () => {
    await generateFastfile(dir, cfg(), NASTY);
    const content = await readFile(join(dir, "fastlane", "Fastfile"), "utf-8");
    expect(content).toContain("workspace: options[:workspace]");
    expect(content).toContain("scheme: options[:scheme]");
    expect(content).not.toMatch(/\.xcworkspace/);
  });

  it("Appfile: values are Ruby-escaped", async () => {
    await generateAppfile(dir, cfg({ bundleId: NASTY }), `a"b@x.com`, `p#{y}`);
    const content = await readFile(join(dir, "fastlane", "Appfile"), "utf-8");
    expect(content).toContain(`app_identifier("Bob's \\"App\\" \\#{x}")`);
    expect(content).toContain(`apple_id("a\\"b@x.com")`);
    expect(content).toContain(`package_name("p\\#{y}")`);
    expect(content).not.toContain("&#39;");
    const ok = rubySyntaxOk(join(dir, "fastlane", "Appfile"));
    if (ok !== undefined) expect(ok).toBe(true);
  });
});

describe("service account key path in the Fastfile (item 6)", () => {
  const fastfile = async (p?: string) => {
    await generateFastfile(dir, cfg({ serviceAccountKeyPath: p }), "App");
    return readFile(join(dir, "fastlane", "Fastfile"), "utf-8");
  };
  const jsonKeyLine = (c: string) => c.split("\n").find((l) => l.includes("json_key:"))!;

  it("keeps a project-relative path (also when absolute inside the project)", async () => {
    expect(jsonKeyLine(await fastfile("./keys/play.json"))).toContain('|| "keys/play.json"');
    expect(jsonKeyLine(await fastfile(join(dir, "keys/play.json")))).toContain('|| "keys/play.json"');
  });

  it.each(["/Users/me/keys/play.json", "~/keys/play.json", "../play.json", undefined])(
    "omits the default for %s",
    async (p) => {
      const c = await fastfile(p);
      expect(jsonKeyLine(c).trim()).toBe("json_key: options[:service_account_key]");
      expect(c).not.toContain("/Users/");
      expect(c).not.toContain("~/");
      expect(c).not.toContain("play.json");
    }
  );
});

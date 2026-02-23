import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEasConfig, parseAppConfig } from "../../src/core/eas-parser.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "shipyard-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("parseEasConfig", () => {
  it("parses valid eas.json", async () => {
    await writeFile(
      join(testDir, "eas.json"),
      JSON.stringify({
        build: {
          production: { distribution: "store" },
        },
      })
    );

    const config = await parseEasConfig(testDir);
    expect(config.build.production).toBeDefined();
    expect(config.build.production.distribution).toBe("store");
  });

  it("throws on missing eas.json", async () => {
    await expect(parseEasConfig(testDir)).rejects.toThrow("eas.json not found");
  });

  it("throws on missing build section", async () => {
    await writeFile(join(testDir, "eas.json"), JSON.stringify({ submit: {} }));
    await expect(parseEasConfig(testDir)).rejects.toThrow("missing the 'build' section");
  });

  it("throws on invalid JSON", async () => {
    await writeFile(join(testDir, "eas.json"), "not json");
    await expect(parseEasConfig(testDir)).rejects.toThrow("Failed to parse");
  });

  it("parses submit config", async () => {
    await writeFile(
      join(testDir, "eas.json"),
      JSON.stringify({
        build: { production: {} },
        submit: {
          production: {
            ios: { appleId: "test@test.com" },
            android: { serviceAccountKeyPath: "./sa.json" },
          },
        },
      })
    );

    const config = await parseEasConfig(testDir);
    expect(config.submit?.production?.ios?.appleId).toBe("test@test.com");
    expect(config.submit?.production?.android?.serviceAccountKeyPath).toBe("./sa.json");
  });
});

describe("parseAppConfig", () => {
  it("parses valid app.json with expo wrapper", async () => {
    await writeFile(
      join(testDir, "app.json"),
      JSON.stringify({
        expo: {
          name: "MyApp",
          slug: "my-app",
          version: "1.0.0",
          ios: { bundleIdentifier: "com.test.app", buildNumber: "1" },
          android: { package: "com.test.app", versionCode: 1 },
        },
      })
    );

    const config = await parseAppConfig(testDir);
    expect(config.name).toBe("MyApp");
    expect(config.slug).toBe("my-app");
    expect(config.version).toBe("1.0.0");
    expect(config.ios?.bundleIdentifier).toBe("com.test.app");
    expect(config.android?.package).toBe("com.test.app");
    expect(config.android?.versionCode).toBe(1);
  });

  it("throws on missing app.json", async () => {
    await expect(parseAppConfig(testDir)).rejects.toThrow("No app.json");
  });

  it("throws on missing required fields", async () => {
    await writeFile(
      join(testDir, "app.json"),
      JSON.stringify({ expo: { name: "App" } })
    );
    await expect(parseAppConfig(testDir)).rejects.toThrow("missing required fields");
  });

  it("handles app.json without expo wrapper", async () => {
    await writeFile(
      join(testDir, "app.json"),
      JSON.stringify({
        name: "MyApp",
        slug: "my-app",
        version: "2.0.0",
      })
    );

    const config = await parseAppConfig(testDir);
    expect(config.name).toBe("MyApp");
    expect(config.version).toBe("2.0.0");
  });
});

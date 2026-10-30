import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/platforms/android/keystore.js", () => ({ generateKeystore: vi.fn() }));
vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { generateKeystore } from "../../src/platforms/android/keystore.js";
import initCmd from "../../src/commands/init.js";

let dir: string;
let cwd: string;

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-init-")));
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify({ expo: { name: "App", slug: "app", version: "1.0.0", android: { package: "com.x.app", versionCode: 1 } } })
  );
  await writeFile(
    join(dir, "eas.json"),
    JSON.stringify({
      build: { production: {} },
      submit: { production: { android: { serviceAccountKeyPath: "/k/sa.json", track: "internal" } } },
    })
  );
  await writeFile(join(dir, "up.jks"), "x");
  await writeFile(join(dir, "up.json"), JSON.stringify({ keystorePassword: "pw-secret", keyAlias: "myalias", keyPassword: "pw-secret" }));
  process.chdir(dir);
});

afterEach(() => process.chdir(cwd));

describe("init with an existing keystore", () => {
  it("does not generate a keystore, stores paths (never passwords) and seeds the version counter", async () => {
    await initCmd({
      platform: "android",
      json: true,
      nonInteractive: true,
      androidKeystore: join(dir, "up.jks"),
      androidCredentials: join(dir, "up.json"),
      androidLastVersionCode: "3",
    });

    expect(generateKeystore).not.toHaveBeenCalled();

    const raw = await readFile(join(dir, ".shipyard", "config.json"), "utf-8");
    expect(raw).not.toContain("pw-secret");
    const config = JSON.parse(raw);
    expect(config.platforms.android).toMatchObject({
      keystorePath: "up.jks",
      keystoreAlias: "myalias",
      credentialsPath: "up.json",
      serviceAccountKeyPath: "/k/sa.json",
    });
    expect(JSON.parse(await readFile(join(dir, ".shipyard", "version-code.json"), "utf-8"))).toEqual({ android: { lastUsed: 3 } });
    expect(raw).not.toContain(dir);
    expect(await readFile(join(dir, ".gitignore"), "utf-8")).toContain("*.jks");
    expect(await readFile(join(dir, ".shipyard", ".gitignore"), "utf-8")).toContain("history.json");
  });
});

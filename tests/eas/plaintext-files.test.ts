import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { easPlaintextEntries, gitignoreLiteral } from "../../src/commands/init.js";
import type { EasCredentials } from "../../src/core/eas-credentials.js";

let dir: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-easlist-")));
});
const touch = async (rel: string) => {
  await mkdir(join(dir, rel, ".."), { recursive: true });
  await writeFile(join(dir, rel), "x");
  return join(dir, rel);
};
const credsFor = async (files: { android?: string; ios?: Array<[string, string]> }): Promise<EasCredentials> => {
  await touch("credentials.json");
  return {
    file: join(dir, "credentials.json"),
    dir,
    android: files.android ? { keystorePath: await touch(files.android), keystorePassword: "", keyAlias: "a", keyPassword: "" } : undefined,
    ios: files.ios
      ? await Promise.all(files.ios.map(async ([cert, prof], i) => ({ name: `t${i}`, certificatePath: await touch(cert), certificatePassword: "", provisioningProfilePath: await touch(prof) })))
      : undefined,
  };
};
const displays = async (c: EasCredentials) => (await easPlaintextEntries(dir, c)).map((e) => e.display);

describe("easPlaintextEntries", () => {
  it("Expo-docs layout (android/keystores, ios/certs): individual files, never a native folder", async () => {
    const c = await credsFor({ android: "android/keystores/release.keystore", ios: [["ios/certs/dist.p12", "ios/certs/profile.mobileprovision"]] });
    const entries = await easPlaintextEntries(dir, c);
    expect(entries.map((e) => e.display)).toEqual([
      "credentials.json",
      "android/keystores/release.keystore",
      "ios/certs/dist.p12",
      "ios/certs/profile.mobileprovision",
    ]);
    expect(entries.some((e) => e.isDir)).toBe(false);
  });

  it("eas-cli default layout: credentials/ is collapsed to one folder", async () => {
    const c = await credsFor({ android: "credentials/android/keystore.jks", ios: [["credentials/ios/dist-cert.p12", "credentials/ios/profile.mobileprovision"]] });
    const entries = await easPlaintextEntries(dir, c);
    expect(entries.map((e) => [e.display, e.isDir])).toEqual([["credentials.json", false], ["credentials/", true]]);
  });

  it("credentials/ with an extra unrelated file is not collapsed", async () => {
    const c = await credsFor({ android: "credentials/android/keystore.jks" });
    await touch("credentials/notes.txt");
    expect(await displays(c)).toEqual(["credentials.json", "credentials/android/keystore.jks"]);
  });

  it("a folder named credentials inside android/ is never collapsed", async () => {
    await mkdir(join(dir, "android"), { recursive: true });
    const c = await credsFor({ android: "android/credentials/keystore.jks" });
    // credentials.json lives in the project root, so android/credentials is not "next to" it
    expect(await displays(c)).toEqual(["credentials.json", "android/credentials/keystore.jks"]);
    const c2: EasCredentials = { ...c, dir: join(dir, "android"), file: join(dir, "android", "credentials.json") };
    await touch("android/credentials.json");
    const entries = await easPlaintextEntries(dir, c2);
    expect(entries.some((e) => e.isDir)).toBe(false);
  });

  it("files outside the project are listed as ~/ or absolute, not as project files", async () => {
    const c = await credsFor({});
    c.android = { keystorePath: "/somewhere/else/k.jks", keystorePassword: "", keyAlias: "a", keyPassword: "" };
    const entries = await easPlaintextEntries(dir, c);
    expect(entries[1]).toEqual({ display: "/somewhere/else/k.jks", isDir: false, inProject: false });
  });
});

describe("gitignoreLiteral", () => {
  it("escapes glob characters and a leading ! or #", () => {
    expect(gitignoreLiteral("a/b.jks")).toBe("a/b.jks");
    expect(gitignoreLiteral("!x.jks")).toBe("\\!x.jks");
    expect(gitignoreLiteral("#x.jks")).toBe("\\#x.jks");
    expect(gitignoreLiteral("a[1]*?.jks")).toBe("a\\[1\\]\\*\\?.jks");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEasCredentials } from "../../src/core/eas-credentials.js";
import { ShipyardError } from "../../src/utils/errors.js";

let dir: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-easfile-")));
});

const write = (obj: unknown, name = "credentials.json") => writeFile(join(dir, name), typeof obj === "string" ? obj : JSON.stringify(obj));
const expectCode = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(() => undefined, (e) => e);
  expect(err).toBeInstanceOf(ShipyardError);
  expect((err as ShipyardError).code).toBe(code);
  return err as ShipyardError;
};

describe("readEasCredentials (eas-cli credentialsJson schema)", () => {
  it("reads android: paths relative to credentials.json, keyPassword defaults to the keystore password", async () => {
    await write({ android: { keystore: { keystorePath: "credentials/android/keystore.jks", keystorePassword: "sp", keyAlias: "k" } } });
    const c = await readEasCredentials(dir);
    expect(c.file).toBe(join(dir, "credentials.json"));
    expect(c.android).toEqual({
      keystorePath: join(dir, "credentials/android/keystore.jks"),
      keystorePassword: "sp",
      keyAlias: "k",
      keyPassword: "sp",
    });
    expect(c.ios).toBeUndefined();
  });

  it("reads single-target iOS as target 'app' and a multi-target map in order", async () => {
    const t = (n: string) => ({ provisioningProfilePath: `credentials/ios/${n}-profile.mobileprovision`, distributionCertificate: { path: `credentials/ios/${n}-dist-cert.p12`, password: "" } });
    await write({ ios: t("a") });
    expect((await readEasCredentials(dir)).ios!.map((x) => x.name)).toEqual(["app"]);
    await write({ ios: { myapp: t("myapp"), myext: t("myext") } });
    const c = await readEasCredentials(dir);
    expect(c.ios!.map((x) => x.name)).toEqual(["myapp", "myext"]);
    expect(c.ios![1]).toEqual({
      name: "myext",
      certificatePath: join(dir, "credentials/ios/myext-dist-cert.p12"),
      certificatePassword: "", // Joi: password allow('')
      provisioningProfilePath: join(dir, "credentials/ios/myext-profile.mobileprovision"),
    });
  });

  it("accepts a folder and an explicit path", async () => {
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "credentials.json"), JSON.stringify({ android: { keystore: { keystorePath: "k.jks", keystorePassword: "p", keyAlias: "a" } } }));
    expect((await readEasCredentials(dir, "sub")).android!.keystorePath).toBe(join(dir, "sub", "k.jks"));
    expect((await readEasCredentials(dir, "sub/credentials.json")).dir).toBe(join(dir, "sub"));
  });

  it("missing file: EAS_CREDENTIALS_NOT_FOUND with the exact eas-cli menu path", async () => {
    const err = await expectCode(readEasCredentials(dir), "EAS_CREDENTIALS_NOT_FOUND");
    expect(err.fix).toContain("npx eas-cli credentials");
    expect(err.fix).toContain("credentials.json: Upload/Download credentials between EAS servers and your local json");
    expect(err.fix).toContain("Download credentials from EAS to credentials.json");
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["no platform section", "{}"],
    ["android without keystore", { android: {} }],
    ["android without alias", { android: { keystore: { keystorePath: "k", keystorePassword: "p" } } }],
    ["android without password", { android: { keystore: { keystorePath: "k", keyAlias: "a" } } }],
    ["ios without certificate", { ios: { provisioningProfilePath: "p" } }],
    ["ios target without profile", { ios: { t: { distributionCertificate: { path: "c", password: "x" } } } }],
  ])("invalid (%s): EAS_CREDENTIALS_INVALID, no secret in the message", async (_n, body) => {
    await write(body as never);
    const err = await expectCode(readEasCredentials(dir), "EAS_CREDENTIALS_INVALID");
  });

  it("never echoes a password in an error", async () => {
    await write({ android: { keystore: { keystorePath: "k", keystorePassword: "TOP-SECRET-PW" } } });
    const err = await expectCode(readEasCredentials(dir), "EAS_CREDENTIALS_INVALID");
    expect(JSON.stringify(err.toJSON())).not.toContain("TOP-SECRET-PW");
  });

  it("rejects control characters in file paths (they would end up in .gitignore and printed commands)", async () => {
    await write({ android: { keystore: { keystorePath: "credentials/a\n!evil.jks", keystorePassword: "p", keyAlias: "a" } } });
    await expectCode(readEasCredentials(dir), "EAS_CREDENTIALS_INVALID");
    await write({ ios: { t: { provisioningProfilePath: "p", distributionCertificate: { path: "c\u0007.p12", password: "x" } } } });
    await expectCode(readEasCredentials(dir), "EAS_CREDENTIALS_INVALID");
  });
});

import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAscJwt, checkAscApiKey } from "../../src/platforms/ios/asc-check.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const KEY = { keyId: "ABC123DEFG", issuerId: "69a6de70-0000-0000-0000-000000000000", privateKeyPem: P8 };
const NOW = 1_800_000_000;

const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const env = (extra: Record<string, string> = {}) => ({
  APP_STORE_CONNECT_API_KEY_KEY_ID: KEY.keyId,
  APP_STORE_CONNECT_API_KEY_ISSUER_ID: KEY.issuerId,
  APP_STORE_CONNECT_API_KEY_KEY: P8,
  ...extra,
});

describe("buildAscJwt (real crypto)", () => {
  it("is an ES256 JWT that verifies with the matching public key", () => {
    const jwt = buildAscJwt(KEY, NOW);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: KEY.keyId, typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toEqual({ iss: KEY.issuerId, iat: NOW, exp: NOW + 19 * 60, aud: "appstoreconnect-v1" });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(20 * 60);
    const sig = Buffer.from(s, "base64url");
    expect(sig.length).toBe(64); // raw r||s, not DER
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey;
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: other, dsaEncoding: "ieee-p1363" }, sig)).toBe(false);
  });

  it("rejects a key that is not an EC private key", () => {
    expect(() => buildAscJwt({ ...KEY, privateKeyPem: "not a key" }, NOW)).toThrow();
  });
});

describe("checkAscApiKey", () => {
  it("skipped without a key", async () => {
    const fetchImpl = vi.fn();
    expect(await checkAscApiKey({ env: {}, bundleId: "com.x.app", fetchImpl })).toMatchObject({ status: "skipped" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("200 with the app: ok; calls the read-only apps endpoint with a bearer JWT and a timeout", async () => {
    const fetchImpl = vi.fn(async () => res(200, { data: [{ id: "1" }] }));
    const r = await checkAscApiKey({ env: env(), bundleId: "com.x.app", fetchImpl: fetchImpl as never });
    expect(r.status).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.appstoreconnect.apple.com/v1/apps");
    expect(u.searchParams.get("filter[bundleId]")).toBe("com.x.app");
    expect(u.searchParams.get("limit")).toBe("1");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("200 without the app: app-not-found naming the bundle id", async () => {
    const r = await checkAscApiKey({ env: env(), bundleId: "com.x.app", fetchImpl: (async () => res(200, { data: [] })) as never });
    expect(r.status).toBe("app-not-found");
    expect(r.detail).toContain("app record not found for com.x.app");
  });

  it("401: ASC_KEY_INVALID", async () => {
    await expect(checkAscApiKey({ env: env(), bundleId: "com.x.app", fetchImpl: (async () => res(401)) as never })).rejects.toMatchObject({ code: "ASC_KEY_INVALID" });
  });

  it("403: a warning result (not an error) that names the roles", async () => {
    const r = await checkAscApiKey({ env: env(), bundleId: "com.x.app", fetchImpl: (async () => res(403)) as never });
    expect(r.status).toBe("forbidden");
    expect(r.detail).toContain("App Manager or Admin");
  });

  it("network error and 5xx: unreachable, not a failure", async () => {
    const down = await checkAscApiKey({ env: env(), bundleId: "com.x.app", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as never });
    expect(down.status).toBe("unreachable");
    const five = await checkAscApiKey({ env: env(), bundleId: "com.x.app", fetchImpl: (async () => res(503)) as never });
    expect(five.status).toBe("unreachable");
  });

  it("times out via the abort signal", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as never;
    const r = await checkAscApiKey({ env: env(), bundleId: "com.x.app", fetchImpl: hang, timeoutMs: 20 });
    expect(r.status).toBe("unreachable");
    expect(r.detail).toContain("timed out");
  });

  it("reads the key from APP_STORE_CONNECT_API_KEY_KEY_FILEPATH; an unreadable file is ASC_KEY_INVALID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-asc-"));
    const file = join(dir, "AuthKey_X.p8");
    await writeFile(file, P8);
    const e = { APP_STORE_CONNECT_API_KEY_KEY_ID: KEY.keyId, APP_STORE_CONNECT_API_KEY_ISSUER_ID: KEY.issuerId, APP_STORE_CONNECT_API_KEY_KEY_FILEPATH: file };
    const ok = await checkAscApiKey({ env: e, bundleId: "com.x.app", fetchImpl: (async () => res(200, { data: [{}] })) as never });
    expect(ok.status).toBe("ok");
    await expect(checkAscApiKey({ env: { ...e, APP_STORE_CONNECT_API_KEY_KEY_FILEPATH: join(dir, "nope.p8") }, bundleId: "com.x.app", fetchImpl: vi.fn() as never })).rejects.toMatchObject({ code: "ASC_KEY_INVALID" });
  });

  it("a garbage key is ASC_KEY_INVALID and the key material never appears in the error or the results", async () => {
    const err = await checkAscApiKey({ env: env({ APP_STORE_CONNECT_API_KEY_KEY: "-----BEGIN PRIVATE KEY-----\nSECRETSECRET\n-----END PRIVATE KEY-----" }), bundleId: "com.x.app", fetchImpl: vi.fn() as never }).catch((e) => e);
    expect(err.code).toBe("ASC_KEY_INVALID");
    expect(JSON.stringify(err)).not.toContain("SECRETSECRET");
    const ok = await checkAscApiKey({ env: env(), bundleId: "com.x.app", fetchImpl: (async () => res(200, { data: [{}] })) as never });
    expect(JSON.stringify(ok)).not.toContain("PRIVATE KEY");
  });
});

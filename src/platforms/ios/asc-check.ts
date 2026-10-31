import { createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ShipyardError } from "../../utils/errors.js";

/**
 * Read-only App Store Connect API call that proves the .p8 key works and has a role that can see
 * apps: GET /v1/apps?filter[bundleId]=<id>&limit=1 with an ES256 JWT (Apple "Generating Tokens for
 * API Requests": header alg ES256 + kid, payload iss, iat, exp <= 20 minutes, aud
 * "appstoreconnect-v1"). Neither the JWT nor the key is ever logged or returned.
 */
const ASC_HOST = "https://api.appstoreconnect.apple.com";
const TOKEN_LIFETIME_SECONDS = 19 * 60; // Apple rejects tokens valid for more than 20 minutes
const TIMEOUT_MS = 15_000;

export interface AscKeyInput {
  keyId: string;
  issuerId: string;
  /** PEM text of the .p8 (PKCS#8 EC private key) */
  privateKeyPem: string;
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

/** ES256 JWT for the App Store Connect API. Throws on a key that is not an EC P-256 private key. */
export function buildAscJwt(input: AscKeyInput, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const header = { alg: "ES256", kid: input.keyId, typ: "JWT" };
  const payload = { iss: input.issuerId, iat: nowSeconds, exp: nowSeconds + TOKEN_LIFETIME_SECONDS, aud: "appstoreconnect-v1" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(input.privateKeyPem);
  // JWT wants the raw r||s signature (IEEE P1363), not the DER form node produces by default
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

export type AscKeyCheck =
  | { status: "ok"; detail: string }
  | { status: "app-not-found"; detail: string }
  | { status: "unreachable"; detail: string }
  | { status: "skipped"; detail: string };

export interface AscKeyCheckOptions {
  env: Record<string, string | undefined>;
  bundleId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: number;
}

/** The key as PEM from APP_STORE_CONNECT_API_KEY_KEY (PEM or base64 of it) or the file in _KEY_FILEPATH. */
async function readKeyPem(env: Record<string, string | undefined>): Promise<string> {
  const inline = env.APP_STORE_CONNECT_API_KEY_KEY;
  if (inline) {
    const text = inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
    if (text.includes("BEGIN")) return text;
    const decoded = Buffer.from(text, "base64").toString("utf8");
    if (decoded.includes("BEGIN")) return decoded;
    throw new ShipyardError("ASC_KEY_INVALID", "APP_STORE_CONNECT_API_KEY_KEY is not a PEM private key", "Set it to the contents of the .p8 file (or its base64), or use APP_STORE_CONNECT_API_KEY_KEY_FILEPATH");
  }
  const path = env.APP_STORE_CONNECT_API_KEY_KEY_FILEPATH;
  if (!path) throw new Error("no key");
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new ShipyardError(
      "ASC_KEY_INVALID",
      `Cannot read the App Store Connect API key file at ${path}`,
      "Check APP_STORE_CONNECT_API_KEY_KEY_FILEPATH / EXPO_ASC_API_KEY_PATH / ascApiKeyPath in eas.json: it must point to the AuthKey_<id>.p8 you downloaded"
    );
  }
}

/**
 * Checks the App Store Connect API key from `env` (fastlane names). Returns "skipped" when no key
 * is configured. Throws ShipyardError ASC_KEY_INVALID (401, unreadable key) or ASC_KEY_FORBIDDEN
 * (403). A missing app record or a network problem is a result, not an error.
 */
export async function checkAscApiKey(opts: AscKeyCheckOptions): Promise<AscKeyCheck> {
  const keyId = opts.env.APP_STORE_CONNECT_API_KEY_KEY_ID;
  const issuerId = opts.env.APP_STORE_CONNECT_API_KEY_ISSUER_ID;
  if (!keyId || !issuerId || !(opts.env.APP_STORE_CONNECT_API_KEY_KEY || opts.env.APP_STORE_CONNECT_API_KEY_KEY_FILEPATH)) {
    return { status: "skipped", detail: "no App Store Connect API key configured" };
  }
  const pem = await readKeyPem(opts.env);
  let jwt: string;
  try {
    jwt = buildAscJwt({ keyId, issuerId, privateKeyPem: pem }, opts.now);
  } catch {
    throw new ShipyardError(
      "ASC_KEY_INVALID",
      "The App Store Connect API key is not a valid EC private key (.p8)",
      "Use the AuthKey_<id>.p8 file downloaded from App Store Connect > Users and Access > Integrations > App Store Connect API (it can only be downloaded once)"
    );
  }

  const url = new URL(`${ASC_HOST}/v1/apps`);
  url.searchParams.set("filter[bundleId]", opts.bundleId);
  url.searchParams.set("limit", "1");
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      status: "unreachable",
      detail: `could not reach the App Store Connect API (${timedOut ? "timed out" : "network error"}); the key was not checked`,
    };
  }

  if (res.status === 401) {
    throw new ShipyardError(
      "ASC_KEY_INVALID",
      `App Store Connect rejected the API key (401): key id ${keyId} or issuer id ${issuerId} is wrong, or the key was revoked`,
      "Check the key id and issuer id in App Store Connect > Users and Access > Integrations > App Store Connect API, and that the .p8 is the one for that key id"
    );
  }
  if (res.status === 403) {
    throw new ShipyardError(
      "ASC_KEY_FORBIDDEN",
      `The App Store Connect API key ${keyId} is valid but its role is too low (403)`,
      "Create a key with the App Manager or Admin role (Users and Access > Integrations > App Store Connect API), then point APP_STORE_CONNECT_API_KEY_* at it"
    );
  }
  if (res.status !== 200) {
    return { status: "unreachable", detail: `App Store Connect answered HTTP ${res.status}; the key was not checked` };
  }
  let found = false;
  try {
    const body = (await res.json()) as { data?: unknown };
    found = Array.isArray(body.data) && body.data.length > 0;
  } catch {
    return { status: "unreachable", detail: "App Store Connect sent an unreadable answer; the key was not checked" };
  }
  return found
    ? { status: "ok", detail: `App Store Connect API key ${keyId} works and sees ${opts.bundleId}` }
    : {
        status: "app-not-found",
        detail: `The key works, but app record not found for ${opts.bundleId}. Create the app in App Store Connect (My Apps > +) before the first submit`,
      };
}

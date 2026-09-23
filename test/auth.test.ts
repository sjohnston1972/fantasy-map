import { beforeAll, describe, expect, it } from "vitest";
import { checkAccess, resetKeyCache } from "../src/api/auth";

// A throwaway signing key stands in for Cloudflare Access's.
const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-123";
let keys: CryptoKeyPair;
let jwks: unknown;

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const rsa = () =>
  crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;

async function token(claims: Record<string, unknown>, key = keys.privateKey) {
  const head = b64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ aud: [AUD], iss: `https://${TEAM}`, exp: now() + 600, iat: now(), email: "owner@example.com" });
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const fakeFetch = (async () => Response.json(jwks)) as unknown as typeof fetch;
const req = (t?: string, host = "maps.example.net") =>
  new Request(`https://${host}/api/import/x`, { headers: t ? { "Cf-Access-Jwt-Assertion": t } : {} });

beforeAll(async () => {
  keys = await rsa();
  const pub = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  jwks = { keys: [{ kid: "k1", kty: "RSA", n: pub.n, e: pub.e, alg: "RS256" }] };
  resetKeyCache();
});

describe("Access token check", () => {
  it("accepts a valid token and returns the email", async () => {
    expect(await checkAccess(req(await token(good())), env, fakeFetch)).toEqual({ email: "owner@example.com" });
  });
  it("rejects a missing token", async () => {
    expect(await checkAccess(req(), env, fakeFetch)).toBeNull();
  });
  it("rejects a token for another application", async () => {
    expect(await checkAccess(req(await token({ ...good(), aud: ["other"] })), env, fakeFetch)).toBeNull();
  });
  it("rejects an expired token", async () => {
    expect(await checkAccess(req(await token({ ...good(), exp: now() - 10 })), env, fakeFetch)).toBeNull();
  });
  it("rejects a token from another issuer", async () => {
    expect(await checkAccess(req(await token({ ...good(), iss: "https://evil.example" })), env, fakeFetch)).toBeNull();
  });
  it("rejects a token signed with a different key", async () => {
    const other = await rsa();
    expect(await checkAccess(req(await token(good(), other.privateKey)), env, fakeFetch)).toBeNull();
  });
  it("rejects a tampered token", async () => {
    const t = await token(good());
    const [h, , s] = t.split(".");
    const forged = `${h}.${b64url(JSON.stringify({ ...good(), email: "attacker@example.com" }))}.${s}`;
    expect(await checkAccess(req(forged), env, fakeFetch)).toBeNull();
  });
  it("fails closed when Access is not configured", async () => {
    expect(await checkAccess(req(await token(good())), {}, fakeFetch)).toBeNull();
  });
  it("only honours the local-development bypass on localhost", async () => {
    expect(await checkAccess(req(undefined, "127.0.0.1:8799"), { DEV_NO_AUTH: "1" }, fakeFetch)).toEqual({ email: "local-dev" });
    expect(await checkAccess(req(undefined, "maps.example.net"), { DEV_NO_AUTH: "1" }, fakeFetch)).toBeNull();
  });
});

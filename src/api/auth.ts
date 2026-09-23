// Checks the Cloudflare Access token on admin API requests.
//
// Access already blocks strangers at Cloudflare's edge before a request reaches the
// Worker. This is the second lock: the Worker verifies Access's signed token itself, so
// the API stays closed even if the Access application were removed or misconfigured.
// Like a firewall rule on the server behind a firewall appliance.

export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_NO_AUTH?: string; // "1" in .dev.vars only; honoured for localhost requests only
}

export interface Identity {
  email: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let keyCache: { domain: string; at: number; keys: Map<string, CryptoKey> } | null = null;
const KEY_CACHE_MS = 60 * 60 * 1000;

export async function checkAccess(request: Request, env: AuthEnv, fetchKeys: typeof fetch = fetch): Promise<Identity | null> {
  const url = new URL(request.url);
  if (env.DEV_NO_AUTH === "1" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    return { email: "local-dev" };
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null; // fail closed
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const claims = await verifyJwt(token, env.ACCESS_TEAM_DOMAIN, fetchKeys);
  if (!claims) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) return null;
  return { email: typeof claims.email === "string" ? claims.email : "unknown" };
}

async function verifyJwt(token: string, domain: string, fetchKeys: typeof fetch): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlText(parts[0]));
    claims = JSON.parse(b64urlText(parts[1]));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const key = await accessKey(domain, header.kid, fetchKeys);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  return ok ? claims : null;
}

async function accessKey(domain: string, kid: string, fetchKeys: typeof fetch): Promise<CryptoKey | null> {
  const fresh = keyCache && keyCache.domain === domain && Date.now() - keyCache.at < KEY_CACHE_MS;
  if (!fresh || !keyCache!.keys.has(kid)) {
    // Access rotates its signing keys; refetch when the cache is old or the key is new.
    const res = await fetchKeys(`https://${domain}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const { keys } = (await res.json()) as { keys: Jwk[] };
    const map = new Map<string, CryptoKey>();
    for (const k of keys ?? []) {
      if (k.kty !== "RSA") continue;
      map.set(
        k.kid,
        await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
      );
    }
    keyCache = { domain, at: Date.now(), keys: map };
  }
  return keyCache!.keys.get(kid) ?? null;
}

// Test hook: forget cached keys.
export function resetKeyCache() {
  keyCache = null;
}

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlText(s: string): string {
  return new TextDecoder().decode(b64urlBytes(s));
}

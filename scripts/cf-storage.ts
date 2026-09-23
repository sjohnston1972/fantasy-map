// R2 and D1 over Cloudflare's REST API, shaped like the Worker's bindings, so scripts on
// this machine can run the Worker's own import code (src/api/import.ts) against the live
// library. Uses CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from .env.

const API = "https://api.cloudflare.com/client/v4/accounts";

export interface CfConfig {
  token: string;
  account: string;
  bucket: string;
  database: string;
}

async function cf(c: CfConfig, path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${c.account}/${path}`, { ...init, headers: { Authorization: `Bearer ${c.token}`, ...(init.headers ?? {}) } });
    // The API rate-limits bursts; back off and retry a few times.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    return res;
  }
}

export function d1(c: CfConfig) {
  const query = async (sql: string, params: unknown[]) => {
    const res = await cf(c, `d1/database/${c.database}/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql, params }) });
    const body = (await res.json()) as { success: boolean; errors: unknown[]; result: { results: unknown[]; meta: { changes?: number } }[] };
    if (!body.success) throw new Error(`D1 query failed: ${JSON.stringify(body.errors)} for ${sql.slice(0, 80)}`);
    return body.result[0];
  };
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => statement(sql, p),
    first: async <T>() => ((await query(sql, params)).results[0] as T) ?? null,
    all: async () => ({ results: (await query(sql, params)).results }),
    run: async () => ({ meta: (await query(sql, params)).meta }),
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

export function r2(c: CfConfig) {
  const url = (key: string) => `r2/buckets/${c.bucket}/objects/${encodeURIComponent(key)}`;
  return {
    async put(key: string, body: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }) {
      const res = await cf(c, url(key), { method: "PUT", headers: { "Content-Type": opts?.httpMetadata?.contentType ?? "application/octet-stream" }, body: body as BodyInit });
      if (!res.ok) throw new Error(`R2 put ${key} failed: ${res.status} ${await res.text()}`);
    },
    async get(key: string) {
      const res = await cf(c, url(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 get ${key} failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      return {
        body: buf,
        httpEtag: res.headers.get("etag") ?? "",
        json: async () => JSON.parse(new TextDecoder().decode(buf)),
        text: async () => new TextDecoder().decode(buf),
        arrayBuffer: async () => buf,
      };
    },
    async head(key: string) {
      const res = await cf(c, url(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (res.ok) return { key };
      // Fall back to a full read where HEAD is not supported.
      const got = await cf(c, url(key));
      return got.ok ? { key } : null;
    },
    async list(prefix: string) {
      const res = await cf(c, `r2/buckets/${c.bucket}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000`);
      const body = (await res.json()) as { result: { key: string }[] };
      return body.result ?? [];
    },
  } as unknown as R2Bucket & { list(prefix: string): Promise<{ key: string }[]> };
}

export function configFromEnv(env: Record<string, string | undefined>): CfConfig {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set in .env");
  return { token, account, bucket: "fantasy-map-library", database: "80f45384-4254-44ac-9e8b-b61caf057cec" };
}

// Minimal .env reader (KEY=value lines; anything else ignored).
export function readDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

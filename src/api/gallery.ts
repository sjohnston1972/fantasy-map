// Public map gallery. Anyone can publish a map (its share link, a name and a thumbnail)
// and browse what others published. Entries go up at once; the admin page (behind Access)
// can hide or delete them. Nothing about the publisher is stored; their address is used
// only for the rate limit and then forgotten.

export interface GalleryEnv {
  DB: D1Database;
  LIBRARY: R2Bucket;
  PUBLISH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

export interface GalleryEntry {
  id: string;
  name: string;
  code: string;
  edits: string;
  created: string;
  hidden?: number;
}

// Matches the settings code written by src/app/share.ts.
const CODE = /^\d{1,3}\.[0-9a-z]{1,7}\.(p|l|\d{3,4}x\d{3,4})\.\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,2}$/;
const EDITS = /^[A-Za-z0-9_-]{0,20000}$/;
export const MAX_THUMB = 120 * 1024;
const MAX_BODY = 200 * 1024;
const PAGE = 24;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

// Tidy a name and refuse ones that are empty or carry web addresses (the usual spam).
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) return null;
  if (/https?:|:\/\/|www\.|\.(com|net|org|io|xyz|ru|cn)\b/i.test(name)) return null;
  return name;
}

// A thumbnail must be a real, small JPEG: right start and end markers and a frame header
// no bigger than 480 by 700 pixels.
export function jpegSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 200 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    // Start-of-frame markers (baseline, extended, progressive) hold the height and width.
    if (marker >= 0xc0 && marker <= 0xc2) {
      const h = (bytes[i + 5] << 8) | bytes[i + 6];
      const w = (bytes[i + 7] << 8) | bytes[i + 8];
      return w > 0 && h > 0 && w <= 480 && h <= 700 ? [w, h] : null;
    }
    i += 2 + len;
  }
  return null;
}

function fromBase64(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+=*$/.test(s)) return null;
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Public routes under /api/gallery. `path` is what follows "/api/gallery".
export async function handleGallery(request: Request, env: GalleryEnv, path: string): Promise<Response> {
  const url = new URL(request.url);

  if (path === "" && request.method === "GET") {
    const before = url.searchParams.get("before");
    if (before && !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(before)) return json({ error: "bad cursor" }, 400);
    const rows = await env.DB.prepare(
      `SELECT id, name, code, edits, created FROM gallery WHERE hidden = 0 ${before ? "AND created < ?" : ""} ORDER BY created DESC LIMIT ${PAGE}`,
    )
      .bind(...(before ? [before] : []))
      .all<GalleryEntry>();
    const maps = rows.results;
    return json({ maps, next: maps.length === PAGE ? maps[maps.length - 1].created : null }, 200, { "Cache-Control": "public, max-age=30" });
  }

  const thumb = /^\/([0-9a-f]{12})\.jpg$/.exec(path);
  if (thumb && request.method === "GET") {
    const row = await env.DB.prepare("SELECT hidden FROM gallery WHERE id = ?").bind(thumb[1]).first<{ hidden: number }>();
    const obj = row && !row.hidden ? await env.LIBRARY.get(`gallery/${thumb[1]}.jpg`) : null;
    if (!obj) return json({ error: "not found" }, 404);
    return new Response(obj.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  }

  if (path === "" && request.method === "POST") {
    // Only the map page on this site may publish (browsers always send Origin on POST).
    if (request.headers.get("Origin") !== url.origin) return json({ error: "publish from the map page" }, 403);
    if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) return json({ error: "send JSON" }, 415);
    const visitor = request.headers.get("CF-Connecting-IP") ?? "local";
    if (env.PUBLISH_LIMIT && !(await env.PUBLISH_LIMIT.limit({ key: `publish:${visitor}` })).success) {
      return json({ error: "Too many maps published at once. Please wait a minute." }, 429, { "Retry-After": "60" });
    }
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad JSON" }, 400);
    }
    const name = cleanName(body.name);
    if (!name) return json({ error: "Give the map a name of up to 60 characters, without web addresses." }, 400);
    const code = typeof body.code === "string" && CODE.test(body.code) ? body.code : null;
    if (!code) return json({ error: "bad map code" }, 400);
    const edits = typeof body.edits === "string" && EDITS.test(body.edits) ? body.edits : null;
    if (edits === null) return json({ error: "bad edits" }, 400);
    const img = typeof body.thumb === "string" ? fromBase64(body.thumb) : null;
    if (!img || img.length > MAX_THUMB || !jpegSize(img)) return json({ error: "bad thumbnail" }, 400);

    const id = newId();
    const created = new Date().toISOString();
    await env.LIBRARY.put(`gallery/${id}.jpg`, img, { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB.prepare("INSERT INTO gallery (id, name, code, edits, created) VALUES (?, ?, ?, ?, ?)").bind(id, name, code, edits, created).run();
    return json({ id, name, code, edits, created }, 201);
  }

  return json({ error: "not found" }, 404);
}

// Admin routes under /api/import/gallery (Access checked by the caller). `path` is what
// follows "gallery".
export async function handleGalleryAdmin(request: Request, env: GalleryEnv, path: string): Promise<Response> {
  if (path === "" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, name, code, edits, created, hidden FROM gallery ORDER BY created DESC LIMIT 500").all<GalleryEntry>();
    return json({ maps: rows.results });
  }
  // Thumbnails for the admin page, shown whether hidden or not, so entries can be reviewed.
  const thumb = /^\/([0-9a-f]{12})\.jpg$/.exec(path);
  if (thumb && request.method === "GET") {
    const obj = await env.LIBRARY.get(`gallery/${thumb[1]}.jpg`);
    if (!obj) return json({ error: "not found" }, 404);
    return new Response(obj.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
  }
  const m = /^\/([0-9a-f]{12})$/.exec(path);
  if (!m) return json({ error: "not found" }, 404);
  const id = m[1];
  if (request.method === "PATCH") {
    const body = (await request.json().catch(() => ({}))) as { hidden?: unknown };
    if (typeof body.hidden !== "boolean") return json({ error: "send {hidden: true|false}" }, 400);
    const res = await env.DB.prepare("UPDATE gallery SET hidden = ? WHERE id = ?").bind(body.hidden ? 1 : 0, id).run();
    if (!res.meta.changes) return json({ error: "not found" }, 404);
    return json({ id, hidden: body.hidden });
  }
  if (request.method === "DELETE") {
    await env.LIBRARY.delete(`gallery/${id}.jpg`);
    const res = await env.DB.prepare("DELETE FROM gallery WHERE id = ?").bind(id).run();
    if (!res.meta.changes) return json({ error: "not found" }, 404);
    return json({ id, deleted: true });
  }
  return json({ error: "not found" }, 404);
}


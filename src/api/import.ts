// Sheet import API (docs/sheet-import-spec.md section 9). The Worker only moves files
// and rows; all image work happens in the browser.
//
// Routes, all under /api/import/ and all behind Cloudflare Access:
//   POST /sheets                     register a sheet (metadata); returns where to upload it
//   PUT  /sheets/:id/file            the original sheet PNG (checked against its id)
//   GET  /sheets/:id                 sheet metadata, its icons, and the saved review state
//   PUT  /sheets/:id/review          save the review state (boxes, tags) so it can be reopened
//   POST /sheets/:id/approve-row     approve every draft icon in a row that has an SVG
//   POST /icons/:id/files            upload an icon's PNG (and SVG) with its tags; saved as draft
//   PUT  /icons/:id                  change tags, anchor or status of a draft icon
//   GET  /icons?category=&status=    library listing
//   GET  /files/<key>                read a stored sheet or icon file back
//   POST /packs/build                rebuild the symbol packs from approved icons (see packs.ts)

import { buildPacks } from "./packs";

export interface ImportEnv {
  DB: D1Database;
  LIBRARY: R2Bucket;
}

const SHEET_ID = /^[0-9a-f]{16}$/;
const ICON_ID = /^([0-9a-f]{16})-r(\d{1,3})-c(\d{1,3})([a-z]?)$/;
const SCALES = ["region", "world", "town", "dungeon"];
const KINDS = ["point", "pattern"];
const FACINGS = ["left", "right", "none"];
const STATUSES = ["draft", "approved", "rejected"];
const MAX_SHEET_BYTES = 30 * 1024 * 1024;
const MAX_ICON_BYTES = 5 * 1024 * 1024;
const MAX_REVIEW_BYTES = 5 * 1024 * 1024;

type Json = Record<string, unknown>;

export async function handleImport(request: Request, env: ImportEnv, path: string): Promise<Response> {
  const parts = path.split("/").filter(Boolean); // after /api/import/
  const method = request.method;
  try {
    if (parts[0] === "sheets") {
      if (parts.length === 1 && method === "POST") return await registerSheet(request, env);
      const id = parts[1];
      if (!id || !SHEET_ID.test(id)) return error(400, "bad sheet id");
      if (parts.length === 2 && method === "GET") return await getSheet(env, id);
      if (parts[2] === "file" && method === "PUT") return await putSheetFile(request, env, id);
      if (parts[2] === "review" && method === "PUT") return await putReview(request, env, id);
      if (parts[2] === "approve-row" && method === "POST") return await approveRow(request, env, id);
    }
    if (parts[0] === "icons") {
      if (parts.length === 1 && method === "GET") return await listIcons(request, env);
      const id = parts[1];
      if (!id || !ICON_ID.test(id)) return error(400, "bad icon id");
      if (parts[2] === "files" && method === "POST") return await putIconFiles(request, env, id);
      if (parts.length === 2 && method === "PUT") return await updateIcon(request, env, id);
    }
    if (parts[0] === "files" && method === "GET") return await getFile(env, parts.slice(1).join("/"));
    if (parts[0] === "packs" && parts[1] === "build" && method === "POST") return json({ manifest: await buildPacks(env) });
    return error(404, "not found");
  } catch (err) {
    if (err instanceof HttpError) return error(err.status, err.message);
    console.error("import api error", err);
    return error(500, "server error");
  }
}

// ---- sheets ----

async function registerSheet(request: Request, env: ImportEnv): Promise<Response> {
  const b = await readJson(request);
  const id = str(b.id, "id");
  if (!SHEET_ID.test(id)) throw new HttpError(400, "bad sheet id");
  const existing = await env.DB.prepare("SELECT * FROM sheets WHERE id = ?").bind(id).first();
  if (existing) return json({ sheet: existing, existing: true, uploadUrl: `/api/import/sheets/${id}/file` });
  const settings = b.settings && typeof b.settings === "object" ? JSON.stringify(b.settings) : "{}";
  await env.DB.prepare(
    "INSERT INTO sheets (id, filename, width_px, height_px, rows_found, icons_found, settings, source_tool, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      str(b.filename, "filename").slice(0, 200),
      int(b.width_px, "width_px"),
      int(b.height_px, "height_px"),
      int(b.rows_found, "rows_found"),
      int(b.icons_found, "icons_found"),
      settings,
      optStr(b.source_tool)?.slice(0, 200) ?? null,
      new Date().toISOString(),
    )
    .run();
  const sheet = await env.DB.prepare("SELECT * FROM sheets WHERE id = ?").bind(id).first();
  return json({ sheet, existing: false, uploadUrl: `/api/import/sheets/${id}/file` }, 201);
}

async function putSheetFile(request: Request, env: ImportEnv, id: string): Promise<Response> {
  await mustHaveSheet(env, id);
  const bytes = await readBytes(request, MAX_SHEET_BYTES);
  if (!isPng(bytes)) throw new HttpError(400, "not a PNG");
  // The sheet id is the start of the file's SHA-256, so the file must match it.
  const hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).slice(0, 16);
  if (hash !== id) throw new HttpError(400, "file does not match sheet id");
  await env.LIBRARY.put(`sheets/${id}.png`, bytes, { httpMetadata: { contentType: "image/png" } });
  return json({ key: `sheets/${id}.png` });
}

async function getSheet(env: ImportEnv, id: string): Promise<Response> {
  const sheet = await env.DB.prepare("SELECT * FROM sheets WHERE id = ?").bind(id).first();
  if (!sheet) return error(404, "no such sheet");
  const icons = await env.DB.prepare("SELECT * FROM icons WHERE sheet_id = ? ORDER BY row_index, col_index").bind(id).all();
  const review = await env.LIBRARY.get(`sheets/${id}.review.json`);
  const hasFile = !!(await env.LIBRARY.head(`sheets/${id}.png`));
  return json({ sheet, icons: icons.results, review: review ? await review.json() : null, hasFile });
}

async function putReview(request: Request, env: ImportEnv, id: string): Promise<Response> {
  await mustHaveSheet(env, id);
  const bytes = await readBytes(request, MAX_REVIEW_BYTES);
  try {
    JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "review must be JSON");
  }
  await env.LIBRARY.put(`sheets/${id}.review.json`, bytes, { httpMetadata: { contentType: "application/json" } });
  return json({ key: `sheets/${id}.review.json` });
}

async function approveRow(request: Request, env: ImportEnv, id: string): Promise<Response> {
  await mustHaveSheet(env, id);
  const b = await readJson(request);
  const row = int(b.row_index, "row_index");
  const result = await env.DB.prepare(
    "UPDATE icons SET status = 'approved', updated = ? WHERE sheet_id = ? AND row_index = ? AND status = 'draft' AND svg_key IS NOT NULL",
  )
    .bind(new Date().toISOString(), id, row)
    .run();
  const icons = await env.DB.prepare("SELECT * FROM icons WHERE sheet_id = ? AND row_index = ? ORDER BY col_index").bind(id, row).all();
  return json({ approved: result.meta.changes ?? 0, icons: icons.results });
}

// ---- icons ----

async function putIconFiles(request: Request, env: ImportEnv, id: string): Promise<Response> {
  const m = ICON_ID.exec(id)!;
  const sheetId = m[1];
  await mustHaveSheet(env, sheetId);
  const existing = await env.DB.prepare("SELECT status FROM icons WHERE id = ?").bind(id).first<{ status: string }>();
  if (existing && existing.status !== "draft") throw new HttpError(409, `icon is ${existing.status} and locked`);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "expected a multipart form upload");
  }
  const png = form.get("png");
  const svg = form.get("svg");
  const metaRaw = form.get("meta");
  if (!(png instanceof File)) throw new HttpError(400, "png file required");
  if (typeof metaRaw !== "string") throw new HttpError(400, "meta required");
  const pngBytes = new Uint8Array(await png.arrayBuffer());
  if (pngBytes.length > MAX_ICON_BYTES || !isPng(pngBytes)) throw new HttpError(400, "bad png");
  let svgText: string | null = null;
  if (svg instanceof File) {
    if (svg.size > MAX_ICON_BYTES) throw new HttpError(400, "svg too large");
    svgText = await svg.text();
    checkSvg(svgText);
  }
  let metaJson: Json;
  try {
    metaJson = JSON.parse(metaRaw) as Json;
  } catch {
    throw new HttpError(400, "meta must be JSON");
  }
  const meta = parseMeta(metaJson);
  if (Number(m[2]) !== meta.row_index) throw new HttpError(400, "row does not match icon id");

  const pngKey = `icons/${id}.png`;
  const svgKey = svgText ? `icons/${id}.svg` : null;
  await env.LIBRARY.put(pngKey, pngBytes, { httpMetadata: { contentType: "image/png" } });
  if (svgText) await env.LIBRARY.put(svgKey!, svgText, { httpMetadata: { contentType: "image/svg+xml" } });

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO icons (id, sheet_id, row_index, col_index, category, subtype, scales, kind, facing, width_px, height_px, anchor_x, anchor_y, status, png_key, svg_key, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       row_index = excluded.row_index, col_index = excluded.col_index, category = excluded.category, subtype = excluded.subtype,
       scales = excluded.scales, kind = excluded.kind, facing = excluded.facing, width_px = excluded.width_px, height_px = excluded.height_px,
       anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, png_key = excluded.png_key, svg_key = excluded.svg_key, updated = excluded.updated
     WHERE icons.status = 'draft'`,
  )
    .bind(id, sheetId, meta.row_index, meta.col_index, meta.category, meta.subtype, meta.scales, meta.kind, meta.facing, meta.width_px, meta.height_px, meta.anchor_x, meta.anchor_y, pngKey, svgKey, now, now)
    .run();
  const icon = await env.DB.prepare("SELECT * FROM icons WHERE id = ?").bind(id).first();
  return json({ icon }, existing ? 200 : 201);
}

async function updateIcon(request: Request, env: ImportEnv, id: string): Promise<Response> {
  const icon = await env.DB.prepare("SELECT * FROM icons WHERE id = ?").bind(id).first<Json>();
  if (!icon) throw new HttpError(404, "no such icon");
  if (icon.status !== "draft") throw new HttpError(409, `icon is ${icon.status} and locked`);
  const b = await readJson(request);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.tags && typeof b.tags === "object") {
    const t = parseTags(b.tags as Json);
    sets.push("category = ?", "subtype = ?", "scales = ?", "kind = ?", "facing = ?");
    vals.push(t.category, t.subtype, t.scales, t.kind, t.facing);
  }
  if (b.anchor && typeof b.anchor === "object") {
    const a = b.anchor as Json;
    sets.push("anchor_x = ?", "anchor_y = ?");
    vals.push(frac(a.x, "anchor.x"), frac(a.y, "anchor.y"));
  }
  if (b.status !== undefined) {
    const status = str(b.status, "status");
    if (!STATUSES.includes(status)) throw new HttpError(400, "bad status");
    if (status === "approved" && !icon.svg_key) throw new HttpError(400, "cannot approve an icon without an SVG");
    sets.push("status = ?");
    vals.push(status);
  }
  if (!sets.length) throw new HttpError(400, "nothing to change");
  sets.push("updated = ?");
  vals.push(new Date().toISOString());
  await env.DB.prepare(`UPDATE icons SET ${sets.join(", ")} WHERE id = ? AND status = 'draft'`)
    .bind(...vals, id)
    .run();
  return json({ icon: await env.DB.prepare("SELECT * FROM icons WHERE id = ?").bind(id).first() });
}

async function listIcons(request: Request, env: ImportEnv): Promise<Response> {
  const url = new URL(request.url);
  const where: string[] = [];
  const vals: unknown[] = [];
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status");
  if (category) {
    where.push("category = ?");
    vals.push(category);
  }
  if (status) {
    if (!STATUSES.includes(status)) throw new HttpError(400, "bad status");
    where.push("status = ?");
    vals.push(status);
  }
  const sql = `SELECT * FROM icons ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY category, sheet_id, row_index, col_index LIMIT 1000`;
  const rows = await env.DB.prepare(sql).bind(...vals).all();
  return json({ icons: rows.results });
}

async function getFile(env: ImportEnv, key: string): Promise<Response> {
  if (!/^(sheets\/[0-9a-f]{16}\.png|icons\/[0-9a-f]{16}-r\d{1,3}-c\d{1,3}[a-z]?\.(png|svg))$/.test(key)) return error(404, "not found");
  const obj = await env.LIBRARY.get(key);
  if (!obj) return error(404, "not found");
  const headers = new Headers();
  headers.set("Content-Type", key.endsWith(".svg") ? "image/svg+xml" : "image/png");
  headers.set("Cache-Control", "private, no-cache");
  headers.set("ETag", obj.httpEtag);
  // SVGs are served from this site, so lock them down: no scripts, no outside content.
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { headers });
}

// ---- validation ----

function parseMeta(b: Json) {
  return {
    row_index: int(b.row_index, "row_index"),
    col_index: int(b.col_index, "col_index"),
    ...parseTags(b),
    width_px: int(b.width_px, "width_px"),
    height_px: int(b.height_px, "height_px"),
    anchor_x: frac(b.anchor_x, "anchor_x"),
    anchor_y: frac(b.anchor_y, "anchor_y"),
  };
}

function parseTags(b: Json) {
  const category = str(b.category, "category").trim().toLowerCase().slice(0, 100);
  if (!category) throw new HttpError(400, "category required");
  const scales = Array.isArray(b.scales) ? (b.scales as unknown[]).map(String) : String(b.scales ?? "").split(",");
  const clean = SCALES.filter((s) => scales.includes(s));
  if (!clean.length) throw new HttpError(400, "at least one scale required");
  const kind = str(b.kind, "kind");
  if (!KINDS.includes(kind)) throw new HttpError(400, "bad kind");
  const facing = optStr(b.facing) ?? "none";
  if (!FACINGS.includes(facing)) throw new HttpError(400, "bad facing");
  return { category, subtype: (optStr(b.subtype) ?? "").trim().toLowerCase().slice(0, 100) || null, scales: clean.join(","), kind, facing };
}

// Traced SVGs are drawing instructions only. Refuse anything that could run code or
// pull in outside content, since the file is later served from this site.
function checkSvg(svg: string) {
  if (!/^<svg[\s>]/.test(svg.trimStart())) throw new HttpError(400, "not an SVG");
  if (/<script|<foreignObject|<image|<iframe|\bon[a-z]+\s*=|href\s*=|javascript:|<!ENTITY|<!DOCTYPE/i.test(svg)) {
    throw new HttpError(400, "SVG contains disallowed content");
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function mustHaveSheet(env: ImportEnv, id: string) {
  const s = await env.DB.prepare("SELECT id FROM sheets WHERE id = ?").bind(id).first();
  if (!s) throw new HttpError(404, "register the sheet first");
}

async function readJson(request: Request): Promise<Json> {
  const bytes = await readBytes(request, 1024 * 1024);
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Json;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "body must be a JSON object");
}

async function readBytes(request: Request, max: number): Promise<Uint8Array> {
  const len = Number(request.headers.get("Content-Length") ?? 0);
  if (len > max) throw new HttpError(413, "too large");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > max) throw new HttpError(413, "too large");
  return bytes;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string") throw new HttpError(400, `${name} must be text`);
  return v;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function int(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1_000_000) throw new HttpError(400, `${name} must be a whole number`);
  return v;
}

function frac(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new HttpError(400, `${name} must be between 0 and 1`);
  return v;
}

function isPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

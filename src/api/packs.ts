// Symbol packs and the public catalogue (spec "Symbol library and asset pipeline" step 6,
// and "Architecture on Cloudflare").
//
// A pack bundles every approved icon for one map role (mountain, conifer, town...) into one
// JSON file, so the map page downloads a handful of files instead of hundreds. Packs are
// versioned and never overwritten: a rebuild writes packs/<role>-v<n>.json with a new n and
// updates packs/manifest.json to point at it, like bumping a firmware image version. Old
// versions stay, so a cached page never breaks.
//
// Public, read-only routes (no sign-in; rate limited):
//   GET /api/packs/manifest.json         which pack version is current for each role
//   GET /api/packs/<role>-v<n>.json      one pack (cached for a year: it never changes)
//   GET /api/catalogue?role=&scale=      approved icons and their tags
// Admin route (behind Cloudflare Access, under /api/import/):
//   POST /api/import/packs/build         rebuild every pack from the approved icons

export interface PackEnv {
  DB: D1Database;
  LIBRARY: R2Bucket;
}

export interface PackSymbol {
  id: string;
  w: number; // drawing size in its own units (the traced crop)
  h: number;
  anchorX: number; // 0 to 1: where it meets the ground
  anchorY: number;
  facing: string;
  viewBox: string;
  body: string; // the SVG drawing without its outer <svg> element
}

export interface Pack {
  role: string;
  version: number;
  built: string;
  symbols: PackSymbol[];
}

export interface Manifest {
  built: string;
  packs: Record<string, string>; // role -> file name
}

interface IconRow {
  id: string;
  subtype: string;
  facing: string;
  width_px: number;
  height_px: number;
  anchor_x: number;
  anchor_y: number;
  svg_key: string;
}

export async function buildPacks(env: PackEnv): Promise<Manifest> {
  const rows = (await env.DB.prepare("SELECT id, subtype, facing, width_px, height_px, anchor_x, anchor_y, svg_key FROM icons WHERE status = 'approved' AND subtype IS NOT NULL AND subtype <> '' AND svg_key IS NOT NULL ORDER BY subtype, id").all()).results as unknown as IconRow[];
  const byRole = new Map<string, IconRow[]>();
  for (const r of rows) byRole.set(r.subtype, [...(byRole.get(r.subtype) ?? []), r]);

  const old = await readManifest(env);
  const built = new Date().toISOString();
  const manifest: Manifest = { built, packs: {} };
  for (const [role, icons] of byRole) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(role)) continue;
    const symbols: PackSymbol[] = [];
    for (const icon of icons) {
      const obj = await env.LIBRARY.get(icon.svg_key);
      if (!obj) continue;
      const svg = await obj.text();
      const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
      if (!viewBox) continue;
      symbols.push({
        id: icon.id,
        w: icon.width_px,
        h: icon.height_px,
        anchorX: icon.anchor_x,
        anchorY: icon.anchor_y,
        facing: icon.facing,
        viewBox,
        body: svg.replace(/^\s*<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""),
      });
    }
    if (!symbols.length) continue;
    // Keep the version when nothing changed, so caches stay warm.
    const prevName = old?.packs[role];
    const prevVersion = prevName ? Number(/-v(\d+)\.json$/.exec(prevName)?.[1] ?? 0) : 0;
    if (prevName) {
      const prev = await env.LIBRARY.get(`packs/${prevName}`);
      const prevPack = prev ? ((await prev.json()) as Pack) : null;
      if (prevPack && JSON.stringify(prevPack.symbols) === JSON.stringify(symbols)) {
        manifest.packs[role] = prevName;
        continue;
      }
    }
    const version = prevVersion + 1;
    const name = `${role}-v${version}.json`;
    const pack: Pack = { role, version, built, symbols };
    await env.LIBRARY.put(`packs/${name}`, JSON.stringify(pack), { httpMetadata: { contentType: "application/json" } });
    manifest.packs[role] = name;
  }
  await env.LIBRARY.put("packs/manifest.json", JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
  return manifest;
}

async function readManifest(env: PackEnv): Promise<Manifest | null> {
  const obj = await env.LIBRARY.get("packs/manifest.json");
  return obj ? ((await obj.json()) as Manifest) : null;
}

// Public read routes. Returns null when the path is not one of ours.
export async function handlePublic(request: Request, env: PackEnv, path: string): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (path === "packs/manifest.json") {
    const obj = await env.LIBRARY.get("packs/manifest.json");
    if (!obj) return Response.json({ built: null, packs: {} }, { headers: { "Cache-Control": "public, max-age=60" } });
    return new Response(obj.body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
  }
  const m = /^packs\/([a-z][a-z0-9-]{0,40}-v\d{1,6}\.json)$/.exec(path);
  if (m) {
    const obj = await env.LIBRARY.get(`packs/${m[1]}`);
    if (!obj) return Response.json({ error: "no such pack" }, { status: 404 });
    // Versioned files never change, so browsers and Cloudflare can keep them for a year.
    return new Response(obj.body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
  }
  if (path === "catalogue") {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const scale = url.searchParams.get("scale");
    const where = ["status = 'approved'"];
    const vals: unknown[] = [];
    if (role) {
      if (!/^[a-z][a-z0-9-]{0,40}$/.test(role)) return Response.json({ error: "bad role" }, { status: 400 });
      where.push("subtype = ?");
      vals.push(role);
    }
    if (scale) {
      if (!/^(region|world|town|dungeon)$/.test(scale)) return Response.json({ error: "bad scale" }, { status: 400 });
      where.push("(',' || scales || ',') LIKE ?");
      vals.push(`%,${scale},%`);
    }
    const rows = await env.DB.prepare(`SELECT id, subtype AS role, category, scales, kind, facing, width_px, height_px, anchor_x, anchor_y FROM icons WHERE ${where.join(" AND ")} ORDER BY subtype, id LIMIT 1000`).bind(...vals).all();
    return Response.json({ icons: rows.results }, { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
  }
  return null;
}

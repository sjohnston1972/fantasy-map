import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The real Worker, run in Cloudflare's local simulator with an empty database and bucket.
let mf: Miniflare;
const BASE = "http://localhost";
const SHEET_BYTES = readFileSync("example artifacts/desert.png");
let SHEET_ID = "";

beforeAll(async () => {
  const out = await build({ entryPoints: ["src/worker.ts"], bundle: true, format: "esm", write: false, platform: "neutral", logLevel: "silent" });
  // Miniflare 5 takes a new options layout; the helper converts the familiar one.
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: out.outputFiles[0].text,
      compatibilityDate: "2026-09-01",
      d1Databases: ["DB"],
      r2Buckets: ["LIBRARY"],
      bindings: { DEV_NO_AUTH: "1" }, // honoured for localhost only; the sign-in tests cover the real check
      serviceBindings: { ASSETS: () => new Response("asset") },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of ["0001_import.sql", "0002_gallery.sql"]) {
    const sql = readFileSync(`migrations/${file}`, "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", SHEET_BYTES)).toString("hex");
  SHEET_ID = hash.slice(0, 16);
}, 60000);
afterAll(() => mf?.dispose());

const call = (path: string, init?: RequestInit) => mf.dispatchFetch(`${BASE}/api/import/${path}`, init as never);
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const put = (path: string, body: unknown) => call(path, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" width="4" height="4"><path fill="#000" d="M0 0h4v4z"/></svg>`;
const meta = (row: number, col: number, subtype = "") =>
  JSON.stringify({ row_index: row, col_index: col, category: "cacti", subtype, scales: ["region"], kind: "point", facing: "none", width_px: 4, height_px: 4, anchor_x: 0.5, anchor_y: 1 });

async function uploadIcon(id: string, row: number, col: number, withSvg = true, svg = SVG, subtype = "") {
  const form = new FormData();
  form.append("png", new File([PNG_1x1], "i.png", { type: "image/png" }));
  if (withSvg) form.append("svg", new File([svg], "i.svg", { type: "image/svg+xml" }));
  form.append("meta", meta(row, col, subtype));
  // Encode the multipart body here, so its boundary header survives the trip into the simulator.
  const encoded = new Request("http://encode", { method: "POST", body: form });
  return call(`icons/${id}/files`, {
    method: "POST",
    body: await encoded.arrayBuffer(),
    headers: { "Content-Type": encoded.headers.get("Content-Type")! },
  });
}

const registerBody = () => ({
  id: SHEET_ID,
  filename: "desert.png",
  width_px: 1024,
  height_px: 1536,
  rows_found: 11,
  icons_found: 88,
  settings: { threshold: 200 },
  source_tool: "test model",
});

describe("sheet import API", () => {
  it("registers a sheet once; a second registration reports the existing one", async () => {
    const a = await post("sheets", registerBody());
    expect(a.status).toBe(201);
    expect(((await a.json()) as { existing: boolean }).existing).toBe(false);
    const b = await post("sheets", registerBody());
    expect(b.status).toBe(200);
    expect(((await b.json()) as { existing: boolean }).existing).toBe(true);
    const db = await mf.getD1Database("DB");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM sheets").first<{ n: number }>())!.n).toBe(1);
  });

  it("stores the sheet PNG only if it matches the sheet id", async () => {
    expect((await call(`sheets/${SHEET_ID}/file`, { method: "PUT", body: PNG_1x1 })).status).toBe(400);
    expect((await call(`sheets/${SHEET_ID}/file`, { method: "PUT", body: SHEET_BYTES })).status).toBe(200);
    const r2 = await mf.getR2Bucket("LIBRARY");
    expect(await r2.head(`sheets/${SHEET_ID}.png`)).not.toBeNull();
  });

  it("uploads an icon as a draft with PNG and SVG in R2", async () => {
    const res = await uploadIcon(`${SHEET_ID}-r3-c1`, 3, 1);
    expect(res.status).toBe(201);
    const { icon } = (await res.json()) as { icon: Record<string, unknown> };
    expect(icon).toMatchObject({
      status: "draft",
      category: "cacti",
      scales: "region",
      png_key: `icons/${SHEET_ID}-r3-c1.png`,
      svg_key: `icons/${SHEET_ID}-r3-c1.svg`,
    });
    const r2 = await mf.getR2Bucket("LIBRARY");
    expect(await (await r2.get(`icons/${SHEET_ID}-r3-c1.svg`))!.text()).toBe(SVG);
  });

  it("approves an icon, then locks it against changes and re-upload", async () => {
    const id = `${SHEET_ID}-r3-c1`;
    const res = await put(`icons/${id}`, { status: "approved" });
    expect(((await res.json()) as { icon: { status: string } }).icon.status).toBe("approved");
    expect((await put(`icons/${id}`, { status: "draft" })).status).toBe(409);
    expect((await uploadIcon(id, 3, 1)).status).toBe(409);
  });

  it("records a rejected icon (PNG only) so the cell is not imported again", async () => {
    const id = `${SHEET_ID}-r3-c2`;
    expect((await uploadIcon(id, 3, 2, false)).status).toBe(201);
    expect((await put(`icons/${id}`, { status: "approved" })).status).toBe(400); // no SVG
    const res = await put(`icons/${id}`, { status: "rejected" });
    expect(((await res.json()) as { icon: unknown }).icon).toMatchObject({ status: "rejected", svg_key: null });
  });

  it("approves every draft with an SVG in a row", async () => {
    await uploadIcon(`${SHEET_ID}-r4-c1`, 4, 1);
    await uploadIcon(`${SHEET_ID}-r4-c2`, 4, 2);
    const res = await post(`sheets/${SHEET_ID}/approve-row`, { row_index: 4 });
    const body = (await res.json()) as { approved: number; icons: { status: string }[] };
    expect(body.approved).toBe(2);
    expect(body.icons.every((i) => i.status === "approved")).toBe(true);
  });

  it("saves the review state and returns it with the sheet and its icons", async () => {
    await call(`sheets/${SHEET_ID}/review`, { method: "PUT", body: JSON.stringify({ version: 1, rows: [] }) });
    const res = await call(`sheets/${SHEET_ID}`);
    const body = (await res.json()) as { sheet: { id: string }; icons: unknown[]; review: { version: number }; hasFile: boolean };
    expect(body.sheet.id).toBe(SHEET_ID);
    expect(body.icons).toHaveLength(4);
    expect(body.review.version).toBe(1);
    expect(body.hasFile).toBe(true);
  });

  it("re-registering the same sheet creates no duplicate rows", async () => {
    await post("sheets", registerBody());
    const db = await mf.getD1Database("DB");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM sheets").first<{ n: number }>())!.n).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM icons").first<{ n: number }>())!.n).toBe(4);
  });

  it("lists icons by category and status", async () => {
    const res = await call("icons?category=cacti&status=approved");
    expect(((await res.json()) as { icons: unknown[] }).icons).toHaveLength(3);
  });

  it("serves stored files back, with SVGs locked down", async () => {
    const res = await call(`files/icons/${SHEET_ID}-r3-c1.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await call("files/sheets/..%2F..%2Fsecret")).status).toBe(404);
  });

  it("refuses SVGs that could run code, bad ids and bad sheet ids", async () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    expect((await uploadIcon(`${SHEET_ID}-r5-c1`, 5, 1, true, evil)).status).toBe(400);
    expect((await uploadIcon(`${SHEET_ID}-r5-c1`, 5, 1, true, `<svg onload="x()"/>`)).status).toBe(400);
    expect((await call("icons/not-an-id/files", { method: "POST", body: new FormData() })).status).toBe(400);
    expect((await post("sheets", { ...registerBody(), id: "../../x" })).status).toBe(400);
  });

  it("answers a malformed upload with 400, not a server error", async () => {
    const res = await call(`icons/${SHEET_ID}-r6-c1/files`, { method: "POST", body: "not multipart", headers: { "Content-Type": "text/plain" } });
    expect(res.status).toBe(400);
  });

  it("will not store icons for a sheet that was never registered", async () => {
    expect((await uploadIcon("0000000000000000-r1-c1", 1, 1)).status).toBe(404);
  });
});

describe("sign-in check", () => {
  it("rejects API calls without an Access token when not on localhost", async () => {
    const res = await mf.dispatchFetch(`https://maps.clydeford.net/api/import/sheets/${SHEET_ID}`);
    expect(res.status).toBe(401);
  });

  it("leaves the public health check open", async () => {
    expect((await mf.dispatchFetch("https://maps.clydeford.net/api/health")).status).toBe(200);
  });
});

describe("symbol packs and the public catalogue", () => {
  const PUBLIC = "https://maps.clydeford.net/api";
  const publicGet = (path: string) => mf.dispatchFetch(`${PUBLIC}/${path}`);

  it("builds one versioned pack per role from approved icons", async () => {
    for (const col of [1, 2]) {
      await uploadIcon(`${SHEET_ID}-r7-c${col}`, 7, col, true, SVG, "mountain");
      await put(`icons/${SHEET_ID}-r7-c${col}`, { status: "approved" });
    }
    const res = await post("packs/build", {});
    const { manifest } = (await res.json()) as { manifest: { packs: Record<string, string> } };
    expect(manifest.packs.mountain).toBe("mountain-v1.json");
  });

  it("serves the manifest and packs to anyone, without signing in", async () => {
    const m = await publicGet("packs/manifest.json");
    expect(m.status).toBe(200);
    const { packs } = (await m.json()) as { packs: Record<string, string> };
    const p = await publicGet(`packs/${packs.mountain}`);
    expect(p.status).toBe(200);
    expect(p.headers.get("cache-control")).toContain("immutable");
    const pack = (await p.json()) as { role: string; symbols: { body: string; viewBox: string }[] };
    expect(pack.role).toBe("mountain");
    expect(pack.symbols).toHaveLength(2);
    expect(pack.symbols[0].viewBox).toBe("0 0 4 4");
    expect(pack.symbols[0].body).toContain("<path");
    expect(pack.symbols[0].body).not.toContain("<svg");
  });

  it("keeps the version when nothing changed, and bumps it when icons change", async () => {
    const again = (await (await post("packs/build", {})).json()) as { manifest: { packs: Record<string, string> } };
    expect(again.manifest.packs.mountain).toBe("mountain-v1.json");
    await uploadIcon(`${SHEET_ID}-r7-c3`, 7, 3, true, SVG, "mountain");
    await put(`icons/${SHEET_ID}-r7-c3`, { status: "approved" });
    const bumped = (await (await post("packs/build", {})).json()) as { manifest: { packs: Record<string, string> } };
    expect(bumped.manifest.packs.mountain).toBe("mountain-v2.json");
    // The old version is still there for pages that cached the old manifest.
    expect((await publicGet("packs/mountain-v1.json")).status).toBe(200);
  });

  it("answers catalogue questions by role and scale", async () => {
    const res = await publicGet("catalogue?role=mountain&scale=region");
    const { icons } = (await res.json()) as { icons: { role: string }[] };
    expect(icons).toHaveLength(3);
    expect(icons.every((i) => i.role === "mountain")).toBe(true);
    expect((await publicGet("catalogue?role=../x")).status).toBe(400);
  });

  it("keeps pack building behind sign-in", async () => {
    const res = await mf.dispatchFetch("https://maps.clydeford.net/api/import/packs/build", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("refuses odd pack names", async () => {
    expect((await publicGet("packs/..%2Fsheets%2Fx.json")).status).toBe(404);
    expect((await publicGet("packs/mountain.json")).status).toBe(404);
  });
});

// A minimal JPEG: start marker, a JFIF header, a frame header giving the size, filler, end.
function fakeJpeg(w: number, h: number): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof, ...new Array(300).fill(0), 0xff, 0xd9]);
}

describe("public map gallery", () => {
  const gallery = (path = "", init?: RequestInit) => mf.dispatchFetch(`${BASE}/api/gallery${path}`, init as never);
  const publish = (body: Record<string, unknown>, origin = BASE) =>
    gallery("", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: origin } });
  const good = () => ({ name: "  The   Northern Reaches ", code: "1.acm9.p.35.50.60.5", edits: "q1YqzjMsKinKzU", thumb: fakeJpeg(360, 509).toString("base64") });
  let id = "";

  it("publishes a map and lists it, newest first", async () => {
    const res = await publish(good());
    expect(res.status).toBe(201);
    const made = (await res.json()) as { id: string; name: string };
    expect(made.id).toMatch(/^[0-9a-f]{12}$/);
    expect(made.name).toBe("The Northern Reaches");
    id = made.id;
    await publish({ ...good(), name: "Second map", edits: "" });
    const list = (await (await gallery()).json()) as { maps: { id: string; name: string; code: string; edits: string }[]; next: string | null };
    expect(list.maps.map((m) => m.name)).toEqual(["Second map", "The Northern Reaches"]);
    expect(list.maps[1]).toMatchObject({ id, code: "1.acm9.p.35.50.60.5", edits: "q1YqzjMsKinKzU" });
    expect(list.next).toBeNull();
  });

  it("serves the thumbnail as a JPEG", async () => {
    const res = await gallery(`/${id}.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer()).equals(fakeJpeg(360, 509))).toBe(true);
  });

  it("only accepts maps sent from the map page", async () => {
    expect((await publish(good(), "https://evil.example")).status).toBe(403);
    expect((await gallery("", { method: "POST", body: JSON.stringify(good()), headers: { "Content-Type": "application/json" } })).status).toBe(403);
  });

  it("refuses bad names, codes, edits and thumbnails", async () => {
    for (const name of ["", "   ", "x".repeat(61), "Visit www.spam.example", "https://spam", "cheap pills.com", 42]) expect((await publish({ ...good(), name })).status, String(name)).toBe(400);
    for (const code of ["", "1.acm9.q.35.50.60.5", "1.acm9.p.35.50.60.5;drop", "<b>"]) expect((await publish({ ...good(), code })).status, code).toBe(400);
    expect((await publish({ ...good(), edits: "has spaces" })).status).toBe(400);
    expect((await publish({ ...good(), thumb: PNG_1x1.toString("base64") })).status).toBe(400);
    expect((await publish({ ...good(), thumb: fakeJpeg(2000, 3000).toString("base64") })).status).toBe(400);
    expect((await publish({ ...good(), thumb: Buffer.alloc(130 * 1024, 1).toString("base64") })).status).toBe(400);
    expect((await gallery("", { method: "POST", body: "{", headers: { "Content-Type": "application/json", Origin: BASE } })).status).toBe(400);
  });

  it("lets the admin hide a map, which takes it off the public gallery", async () => {
    const admin = (await (await call("gallery")).json()) as { maps: { id: string; hidden: number }[] };
    expect(admin.maps.find((m) => m.id === id)?.hidden).toBe(0);
    const res = await call(`gallery/${id}`, { method: "PATCH", body: JSON.stringify({ hidden: true }), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(200);
    const list = (await (await gallery()).json()) as { maps: { id: string }[] };
    expect(list.maps.some((m) => m.id === id)).toBe(false);
    expect((await gallery(`/${id}.jpg`)).status).toBe(404);
    expect((await call(`gallery/${id}.jpg`)).status).toBe(200); // the admin can still see it
    await call(`gallery/${id}`, { method: "PATCH", body: JSON.stringify({ hidden: false }), headers: { "Content-Type": "application/json" } });
    expect((await gallery(`/${id}.jpg`)).status).toBe(200);
  });

  it("lets the admin delete a map and its thumbnail", async () => {
    expect((await call(`gallery/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(`gallery/${id}.jpg`)).status).toBe(404);
    expect((await call(`gallery/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("keeps the admin routes behind sign-in", async () => {
    const res = await mf.dispatchFetch("https://maps.example/api/import/gallery");
    expect(res.status).toBe(401);
  });
});

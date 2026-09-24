// Test server for the browser tests (e2e/). Serves the built public/ folder, and stands in
// for the Worker's API: symbol packs are small made-up drawings (hollow outlines, so the
// tests also cover picking a drawing by clicking in its gaps), and the gallery is empty.
// Run `npm run build` first; Playwright starts this server itself (playwright.config.ts).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 8810);
const ROOT = normalize(join(import.meta.dirname, "..", "public"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".map": "application/json", ".txt": "text/plain" };
const ROLES = ["mountain", "hill", "conifer", "broadleaf", "reeds", "grass", "dune", "cactus", "snow", "village", "town", "capital", "landmark", "bridge", "emblem", "sea-monsters"];

// A hollow drawing: an outline ring 400 by 300 units, with a notch that differs per drawing
// so each drawing is distinguishable. The middle is empty, like a real traced drawing.
function pack(role) {
  const symbols = [0, 1, 2, 3].map((n) => ({
    id: `${role}-${n + 1}`,
    w: 40,
    h: 30,
    anchorX: 0.5,
    anchorY: 1,
    facing: "none",
    viewBox: "0 0 400 300",
    body: `<path fill="#000" fill-rule="evenodd" d="M0 300L200 0L400 300ZM60 270L200 60L340 270Z"/><rect fill="#000" x="${20 + n * 90}" y="280" width="40" height="20"/>`,
  }));
  return { role, version: 1, symbols };
}

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || body instanceof Buffer ? body : JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);
  if (path === "/api/packs/manifest.json") return send(res, 200, { built: "test", packs: Object.fromEntries(ROLES.map((r) => [r, `${r}-v1.json`])), titles: { "sea-monsters": "sea monsters" } });
  const m = /^\/api\/packs\/([a-z][a-z-]*)-v1\.json$/.exec(path);
  if (m && ROLES.includes(m[1])) return send(res, 200, pack(m[1]));
  if (path === "/api/gallery") return req.method === "POST" ? send(res, 201, { id: "000000000000" }) : send(res, 200, { maps: [], next: null });
  if (path.startsWith("/api/")) return send(res, 404, { error: "not found" });
  let file = normalize(join(ROOT, path.endsWith("/") ? path + "index.html" : path));
  if (!file.startsWith(ROOT)) return send(res, 403, "no", "text/plain");
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`e2e server on http://127.0.0.1:${PORT}`));

// Renders every approved icon in the live library into one PNG, grouped by map role, so
// the whole library can be checked at a glance. Usage:
//   node scripts/run.mjs scripts/contact-sheet.ts <out.png>
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { configFromEnv, d1, r2, readDotEnv } from "./cf-storage";

const out = process.argv[2] ?? "contact.png";
const cfg = configFromEnv(readDotEnv(readFileSync(".env", "utf8")));
const db = d1(cfg);
const bucket = r2(cfg);
const rows = (await db.prepare("SELECT id, subtype, svg_key FROM icons WHERE status = 'approved' ORDER BY subtype, id").all()).results as { id: string; subtype: string; svg_key: string }[];

const TILE = 88;
const PER_ROW = 16;
const groups = new Map<string, typeof rows>();
for (const r of rows) groups.set(r.subtype, [...(groups.get(r.subtype) ?? []), r]);
const lines = [...groups.values()].reduce((n, g) => n + Math.ceil(g.length / PER_ROW), 0);
const W = PER_ROW * TILE + 120;
const H = lines * TILE + 20;
const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`];
let line = 0;
for (const [role, list] of groups) {
  parts.push(`<text x="8" y="${line * TILE + 50}" font-family="sans-serif" font-size="15">${role}</text>`);
  for (let k = 0; k < list.length; k++) {
    const obj = await bucket.get(list[k].svg_key);
    const svg = obj ? await obj.text() : "";
    const vb = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 1 1";
    const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const x = 120 + (k % PER_ROW) * TILE;
    const y = (line + Math.floor(k / PER_ROW)) * TILE + 6;
    parts.push(`<svg x="${x}" y="${y}" width="${TILE - 8}" height="${TILE - 8}" viewBox="${vb}" preserveAspectRatio="xMidYMax meet">${inner}</svg><rect x="${x}" y="${y}" width="${TILE - 8}" height="${TILE - 8}" fill="none" stroke="#ddd"/>`);
  }
  line += Math.ceil(list.length / PER_ROW);
}
parts.push("</svg>");
writeFileSync(out, new Resvg(parts.join(""), { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`wrote ${out}: ${rows.length} icons in ${groups.size} roles`);

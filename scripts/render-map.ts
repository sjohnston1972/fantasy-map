// Draws one map with the live symbol packs and saves it as SVG and PNG, for checking the
// look without a browser. Usage:
//   node scripts/run.mjs scripts/render-map.ts <seed> <out-prefix> [crop x,y,w,h]
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { toInkSet, type InkSymbol } from "../src/gen/inkset";
import { generate } from "../src/gen/pipeline";
import { renderSvg } from "../src/gen/svg";
import { configFromEnv, r2, readDotEnv } from "./cf-storage";

const [seedArg, prefix = "map", crop] = process.argv.slice(2);
const bucket = r2(configFromEnv(readDotEnv(readFileSync(".env", "utf8"))));
const manifest = (await (await bucket.get("packs/manifest.json"))!.json()) as { packs: Record<string, string> };
const packs = await Promise.all(Object.values(manifest.packs).map(async (name) => (await (await bucket.get(`packs/${name}`))!.json()) as { role: string; symbols: InkSymbol[] }));
const ink = toInkSet(packs);

const t0 = performance.now();
// GEN_V=1 renders with an older generator version, to compare.
const m = generate({ seed: Number(seedArg ?? 482913), v: process.env.GEN_V ? Number(process.env.GEN_V) : undefined });
const svg = renderSvg({ width: m.settings.width, height: m.settings.height, water: m.water, symbols: m.symbols, towns: m.towns, labels: m.labels, ink });
console.log(m.labels.labels.map((l) => `${l.kind}: ${l.text}`).join("\n"));
console.log(`generated in ${Math.round(performance.now() - t0)} ms; SVG ${Math.round(svg.length / 1024)} KB`);
writeFileSync(`${prefix}.svg`, svg);
if (crop) {
  // Render the whole map at full size, then cut the crop out of the pixels.
  const [x, y, w, h] = crop.split(",").map(Number);
  const full = new Resvg(svg, { fitTo: { mode: "width", value: m.settings.width } }).render();
  const { PNG } = await import("pngjs");
  const src = PNG.sync.read(Buffer.from(full.asPng()));
  const out = new PNG({ width: w, height: h });
  for (let r = 0; r < h; r++) src.data.copy(out.data, r * w * 4, ((y + r) * src.width + x) * 4, ((y + r) * src.width + x + w) * 4);
  writeFileSync(`${prefix}.png`, PNG.sync.write(out));
} else {
  writeFileSync(`${prefix}.png`, new Resvg(svg, { fitTo: { mode: "width", value: 1000 } }).render().asPng());
}
console.log(`wrote ${prefix}.svg and ${prefix}.png`);

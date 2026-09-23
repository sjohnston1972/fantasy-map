// Imports symbol sheets into the live library, the same way the Import page does: split,
// read row titles, trace, then store approved icons in R2 and D1 through the Worker's own
// import code. Only rows that match a map role are imported; everything else on a sheet is
// left for a person to import by hand later.
//
// Approval rule (Steven asked for the script to decide): an icon is approved when the
// splitter raised no flags (no automatic cut, no nearby marks left out), it does not touch
// the sheet edge, and it traced to a real drawing. Anything else is rejected, which records
// the cell so it is not imported again. Each role keeps at most a set number of icons.
//
// Usage: node scripts/run.mjs scripts/import-sheets.ts [--dry-run]

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { createWorker, PSM } from "tesseract.js";
import { handleImport } from "../src/api/import";
import { cleanCategory, prepareTitle, TITLE_CHARS } from "../src/import/ocr";
import { allIcons, fromSplit, iconName, markSaved, setRowTags, type Review, type ReviewIcon } from "../src/import/review";
import { DEFAULT_SETTINGS, makeInk, split } from "../src/import/split";
import { DEFAULT_TRACE, medianHeight, MIN_PRINT_HEIGHT, traceIcon, type Potrace } from "../src/import/trace";
import { configFromEnv, d1, r2, readDotEnv } from "./cf-storage";

const SOURCE_TOOL = "ChatGPT (paid subscription)";

// Row title patterns for each map role, and how many icons each role keeps.
const ROLES: { role: string; match: RegExp; cap: number }[] = [
  { role: "mountain", match: /^(single peaks|jagged peaks|rugged peaks|snow.?capped|peaks|twin summits)$/, cap: 32 },
  { role: "hill", match: /^(gentle hills|rocky hills|hills and foothills)$/, cap: 20 },
  { role: "conifer", match: /^trees \(coniferous\)$/, cap: 12 },
  { role: "broadleaf", match: /^trees \(deciduous\)$/, cap: 12 },
  { role: "reeds", match: /^marsh reeds$/, cap: 10 },
  { role: "dune", match: /^sand dunes$/, cap: 14 },
  { role: "cactus", match: /^cacti( and succulents)?$/, cap: 12 },
  { role: "snow", match: /^snowfields$/, cap: 8 },
  { role: "grass", match: /^scrub & heath$/, cap: 8 },
  { role: "village", match: /^villages$/, cap: 8 },
  { role: "town", match: /^towns$/, cap: 8 },
  { role: "capital", match: /^cities$/, cap: 8 },
  { role: "bridge", match: /^bridges (& crossings|and fords)$/, cap: 12 },
  { role: "landmark", match: /^(ruins|forts and outposts|temples and religious sites)$/, cap: 20 },
  { role: "emblem", match: /^banners & standards$/, cap: 8 },
];

const dryRun = process.argv.includes("--dry-run");
const env = readDotEnv(readFileSync(".env", "utf8"));
const cfg = configFromEnv(env);
const storage = { DB: d1(cfg), LIBRARY: r2(cfg) };

async function api(path: string, init?: RequestInit) {
  const res = await handleImport(new Request(`https://local/api/import/${path}`, init), storage, path.split("?")[0]);
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function loadPotrace(): Promise<Potrace> {
  const g = globalThis as Record<string, unknown>;
  g.require = createRequire(import.meta.url);
  g.__dirname = `${process.cwd()}/node_modules/esm-potrace-wasm/dist`;
  const mod = (await import("esm-potrace-wasm")) as unknown as { potrace: Potrace; init: () => Promise<void> };
  await mod.init();
  return mod.potrace;
}

function pngBytes(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
}

async function inParallel<T>(items: T[], n: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}

const potrace = await loadPotrace();
const ocr = await createWorker("eng", 1, { langPath: "node_modules/@tesseract.js-data/eng/4.0.0_best_int", gzip: true, cachePath: process.env.TEMP ?? "/tmp" });
await ocr.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: TITLE_CHARS });

// How many icons each role already has in the library.
const kept = new Map<string, number>();
const existing = (await api("icons?status=approved")).icons as { subtype: string | null }[];
for (const i of existing) if (i.subtype) kept.set(i.subtype, (kept.get(i.subtype) ?? 0) + 1);

const files = readdirSync("example artifacts").filter((f) => f.endsWith(".png") && !/^(map|\d\d_)/.test(f)).sort();
const seenSheets = new Set<string>();
const summary: string[] = [];
for (const file of files) {
  const bytes = readFileSync(`example artifacts/${file}`);
  const sheetId = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  if (seenSheets.has(sheetId)) continue; // the same image under another name
  seenSheets.add(sheetId);

  const img = PNG.sync.read(bytes);
  const result = split(img, DEFAULT_SETTINGS);
  const ink = makeInk(img, DEFAULT_SETTINGS);
  let review: Review = fromSplit(result, ink);

  // Read each row title and decide which rows hold a map role.
  const picks: { rowIndex: number; role: string; title: string }[] = [];
  for (const row of review.rows) {
    if (!row.title) continue;
    const p = prepareTitle(img, row.title);
    const title = cleanCategory((await ocr.recognize(pngBytes(p.data, p.width, p.height))).data.text);
    review = setRowTags(review, row.index, { category: title || null });
    const rule = ROLES.find((r) => r.match.test(title));
    if (rule) {
      review = setRowTags(review, row.index, { subtype: rule.role, scales: ["region"], kind: "point" });
      picks.push({ rowIndex: row.index, role: rule.role, title });
    }
  }
  if (!picks.length) continue;

  const status = await handleImport(new Request(`https://local/api/import/sheets/${sheetId}`), storage, `sheets/${sheetId}`);
  if (status.status === 200) {
    summary.push(`${file}: already in the library, skipped`);
    continue;
  }

  const traceSettings = { ...DEFAULT_TRACE, upscale: medianHeight(allIcons(review)) < MIN_PRINT_HEIGHT };
  let approved = 0;
  let rejected = 0;
  const reasons = new Map<string, number>();
  const decisions: { icon: ReviewIcon; role: string; title: string; ok: boolean }[] = [];
  for (const pick of picks) {
    const row = review.rows.find((r) => r.index === pick.rowIndex)!;
    for (const icon of row.icons) {
      let why = "";
      if (icon.flags.length) why = icon.flags.join("+");
      else if (icon.extras.length) why = "marks left out";
      else if (icon.x <= 1 || icon.y <= 1 || icon.x + icon.w >= img.width - 1 || icon.y + icon.h >= img.height - 1) why = "touches the sheet edge";
      else if (icon.h < 12 || icon.w < 12) why = "too small";
      if ((kept.get(pick.role) ?? 0) >= (ROLES.find((r) => r.role === pick.role)?.cap ?? 0) && !why) continue; // role full: leave as draft
      if (!why) kept.set(pick.role, (kept.get(pick.role) ?? 0) + 1);
      decisions.push({ icon, role: pick.role, title: pick.title, ok: !why });
      if (why) reasons.set(why, (reasons.get(why) ?? 0) + 1);
    }
  }
  if (!decisions.length) continue;
  if (dryRun) {
    summary.push(`${file}: would import ${picks.map((p) => `${p.title} -> ${p.role}`).join(", ")}; approve ${decisions.filter((d) => d.ok).length}, reject ${decisions.filter((d) => !d.ok).length} ${JSON.stringify(Object.fromEntries(reasons))}`);
    continue;
  }

  // Register the sheet and store its PNG, then each icon.
  await api("sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: sheetId, filename: file, width_px: img.width, height_px: img.height, rows_found: review.rows.length, icons_found: allIcons(review).length, settings: DEFAULT_SETTINGS, source_tool: SOURCE_TOOL }),
  });
  await api(`sheets/${sheetId}/file`, { method: "PUT", body: bytes, headers: { "Content-Type": "image/png" } });

  await inParallel(decisions, 4, async ({ icon, ok }) => {
    const row = review.rows.find((r) => r.index === icon.row)!;
    const t = await traceIcon(img, icon, traceSettings, potrace);
    if (ok && t.nodes < 6) return; // traced to almost nothing: leave it out
    const id = iconName(review, sheetId, icon);
    const tags = { category: row.tags.category ?? "", subtype: row.tags.subtype, scales: row.tags.scales, kind: row.tags.kind, facing: icon.autoFacing };
    const form = new FormData();
    form.append("png", new File([pngBytes(t.png, t.width, t.height)], `${id}.png`, { type: "image/png" }));
    if (ok) form.append("svg", new File([t.svg], `${id}.svg`, { type: "image/svg+xml" }));
    form.append("meta", JSON.stringify({ row_index: icon.row, col_index: icon.col, ...tags, width_px: t.width, height_px: t.height, anchor_x: Math.min(1, icon.anchorX), anchor_y: Math.min(1, icon.anchorY) }));
    await api(`icons/${id}/files`, { method: "POST", body: form });
    await api(`icons/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: ok ? "approved" : "rejected" }) });
    review = markSaved(review, icon.key, id, ok ? "approved" : "rejected", tags);
    if (ok) approved++;
    else rejected++;
  });

  // Save the review state so the sheet reopens on the Import page exactly as imported.
  const state = { version: 1, savedAt: new Date().toISOString(), settings: DEFAULT_SETTINGS, traceSettings, review };
  await api(`sheets/${sheetId}/review`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
  summary.push(`${file}: ${picks.map((p) => `${p.title} -> ${p.role}`).join(", ")}; approved ${approved}, rejected ${rejected} ${JSON.stringify(Object.fromEntries(reasons))}`);
  console.log(summary[summary.length - 1]);
}
await ocr.terminate();
console.log("\n" + summary.join("\n"));
console.log("\nIcons per role now:", JSON.stringify(Object.fromEntries(kept)));

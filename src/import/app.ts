// Import page, milestone 1: drop a sheet, see it split into rows, titles and icons.
// Everything runs in the browser; nothing is sent to the server yet.

import { DEFAULT_SETTINGS, iconId, split, type Box, type IconBox, type SplitResult, type SplitSettings } from "./split";

const SVG_NS = "http://www.w3.org/2000/svg";

// Settings shown in the panel (spec 4.7), with their input limits.
const FIELDS: { key: keyof SplitSettings; label: string; min: number; max: number; help: string }[] = [
  { key: "threshold", label: "Ink threshold", min: 1, max: 254, help: "Pixels darker than this count as ink (0 to 255)" },
  { key: "rowGap", label: "Row gap", min: 1, max: 200, help: "Blank lines needed between rows" },
  { key: "colGap", label: "Column gap", min: 1, max: 200, help: "Blank columns needed between icons" },
  { key: "mergeRadius", label: "Merge radius", min: 0, max: 60, help: "How far apart ink can be and still count as one icon" },
  { key: "noiseSize", label: "Noise size", min: 1, max: 100, help: "Specks smaller than this are ignored" },
  { key: "padding", label: "Padding", min: 0, max: 40, help: "Space kept around each crop" },
  { key: "expectedPerRow", label: "Icons per row", min: 0, max: 40, help: "Rows with a different count are flagged (0 turns this off)" },
];

interface Sheet {
  id: string;
  filename: string;
  url: string;
  image: ImageData;
}

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;

const els = {
  drop: $<HTMLElement>("#drop"),
  file: $<HTMLInputElement>("#file"),
  sample: $<HTMLButtonElement>("#sample"),
  workspace: $<HTMLElement>("#workspace"),
  stage: $<HTMLElement>("#stage"),
  img: $<HTMLImageElement>("#sheet"),
  overlay: $<SVGSVGElement>("#overlay"),
  summary: $<HTMLElement>("#summary"),
  rows: $<HTMLOListElement>("#rows"),
  settings: $<HTMLFormElement>("#settings"),
  reset: $<HTMLButtonElement>("#reset"),
  detail: $<HTMLElement>("#detail"),
  status: $<HTMLElement>("#status"),
};

let sheet: Sheet | null = null;
let result: SplitResult | null = null;
let settings: SplitSettings = { ...DEFAULT_SETTINGS };
let selected: string | null = null;

buildSettingsForm();
els.settings.addEventListener("submit", (e) => e.preventDefault());

els.file.addEventListener("change", () => {
  const f = els.file.files?.[0];
  if (f) void load(f);
});
els.drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.drop.classList.add("over");
});
els.drop.addEventListener("dragleave", () => els.drop.classList.remove("over"));
els.drop.addEventListener("drop", (e) => {
  e.preventDefault();
  els.drop.classList.remove("over");
  const f = e.dataTransfer?.files[0];
  if (f) void load(f);
});
els.sample.addEventListener("click", async () => {
  const res = await fetch("sample-desert.png");
  void load(new File([await res.blob()], "desert.png", { type: "image/png" }));
});
els.reset.addEventListener("click", () => {
  settings = { ...DEFAULT_SETTINGS };
  for (const f of FIELDS) (els.settings.elements.namedItem(f.key) as HTMLInputElement).value = String(settings[f.key]);
  rerun();
});

async function load(file: File) {
  if (!file.type.startsWith("image/")) return setStatus(`${file.name} is not an image.`);
  setStatus(`Reading ${file.name}...`);
  const bytes = await file.arrayBuffer();
  const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  if (sheet) URL.revokeObjectURL(sheet.url);
  sheet = {
    id: await sheetId(bytes),
    filename: file.name,
    url: URL.createObjectURL(file),
    image: ctx.getImageData(0, 0, bitmap.width, bitmap.height),
  };
  els.img.src = sheet.url;
  els.overlay.setAttribute("viewBox", `0 0 ${bitmap.width} ${bitmap.height}`);
  els.workspace.hidden = false;
  selected = null;
  rerun();
}

// Spec 8.2: sheet id is the first 16 hex characters of the file's SHA-256.
async function sheetId(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Short delay so typing in a settings box re-splits once, not on every keystroke.
let pending: ReturnType<typeof setTimeout> | undefined;
function rerun() {
  if (!sheet) return;
  clearTimeout(pending);
  pending = setTimeout(() => {
    result = split(sheet!.image, settings);
    render();
  }, 30);
}

function render() {
  if (!sheet || !result) return;
  const r = result;
  const icons = r.rows.flatMap((row) => row.icons);
  const touching = r.rows.filter((row) => row.titleTouching).length;
  const untitled = r.rows.filter((row) => !row.title).length;
  const mismatched = r.rows.filter((row) => row.countMismatch).length;
  const flagged = icons.filter((i) => i.flags.length).length;
  els.summary.innerHTML = "";
  els.summary.append(
    stat("Sheet", `${sheet.filename}`, `id ${sheet.id}, ${r.width} by ${r.height} px`),
    stat("Rows", String(r.rows.length), untitled ? `${untitled} without a title` : "all titled"),
    stat("Icons", String(r.iconCount), flagged ? `${flagged} flagged for review` : "none flagged"),
    stat("Split time", `${Math.round(r.ms)} ms`, touching ? `${touching} titles close to their icons` : "titles all separate"),
  );
  if (mismatched) els.summary.append(stat("Check", `${mismatched} rows`, `not ${settings.expectedPerRow} icons`, true));
  setStatus(`Split into ${r.rows.length} rows and ${r.iconCount} icons.`);

  drawOverlay(r);
  drawRowList(r);
  showDetail();
}

function stat(label: string, value: string, note: string, warn = false) {
  const d = document.createElement("div");
  d.className = warn ? "stat warn" : "stat";
  d.innerHTML = `<span class="label"></span><span class="value"></span><span class="note"></span>`;
  d.querySelector(".label")!.textContent = label;
  d.querySelector(".value")!.textContent = value;
  d.querySelector(".note")!.textContent = note;
  return d;
}

function drawOverlay(r: SplitResult) {
  const svg = els.overlay;
  svg.replaceChildren();
  const stroke = Math.max(1.5, r.width / 600);
  for (const row of r.rows) {
    if (row.title) svg.append(rect(row.title, "title", `Row ${row.index} title${row.titleTouching ? " (close to icons)" : ""}`));
    for (const icon of row.icons) {
      const id = iconId(sheet!.id, icon);
      for (const extra of icon.extras) svg.append(rect(extra, "extra", `Possible split from ${id}`));
      const kind = icon.flags.includes("possible-merge") ? "merge" : icon.flags.includes("possible-split") ? "split" : "icon";
      const el = rect(icon, kind, `${id}${icon.flags.length ? " (" + icon.flags.join(", ").replaceAll("-", " ") + ")" : ""}`);
      el.dataset.id = id;
      el.classList.toggle("selected", id === selected);
      el.addEventListener("click", () => select(id));
      svg.append(el);
      const anchor = document.createElementNS(SVG_NS, "circle");
      anchor.setAttribute("cx", String(icon.x + icon.anchorX * icon.w));
      anchor.setAttribute("cy", String(icon.y + icon.anchorY * icon.h));
      anchor.setAttribute("r", String(stroke * 1.6));
      anchor.setAttribute("class", "anchor");
      svg.append(anchor);
    }
  }
}

function rect(b: Box, kind: string, label: string) {
  const el = document.createElementNS(SVG_NS, "rect");
  el.setAttribute("x", String(b.x));
  el.setAttribute("y", String(b.y));
  el.setAttribute("width", String(b.w));
  el.setAttribute("height", String(b.h));
  el.setAttribute("class", `box ${kind}`);
  const t = document.createElementNS(SVG_NS, "title");
  t.textContent = label;
  el.append(t);
  return el;
}

function drawRowList(r: SplitResult) {
  els.rows.replaceChildren();
  for (const row of r.rows) {
    const li = document.createElement("li");
    li.className = row.countMismatch || !row.title ? "row warn" : "row";
    const head = document.createElement("div");
    head.className = "row-head";
    head.innerHTML = `<span class="row-num"></span><span class="row-count"></span>`;
    head.querySelector(".row-num")!.textContent = `Row ${row.index}`;
    head.querySelector(".row-count")!.textContent = `${row.icons.length} icons`;
    li.append(head);
    if (row.title) {
      const c = crop(row.title, 2, 260);
      c.className = "title-crop";
      c.setAttribute("role", "img");
      c.setAttribute("aria-label", `Detected title for row ${row.index}`);
      li.append(c);
    } else {
      const p = document.createElement("p");
      p.className = "missing";
      p.textContent = "No title found";
      li.append(p);
    }
    const notes: string[] = [];
    if (row.titleTouching) notes.push("title close to icons");
    if (row.countMismatch) notes.push(`expected ${settings.expectedPerRow}`);
    if (notes.length) {
      const p = document.createElement("p");
      p.className = "row-note";
      p.textContent = notes.join(", ");
      li.append(p);
    }
    li.tabIndex = 0;
    const focus = () => els.stage.querySelector(`[data-id="${iconId(sheet!.id, { row: row.index, col: 1 })}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    li.addEventListener("click", focus);
    li.addEventListener("keydown", (e) => e.key === "Enter" && focus());
    els.rows.append(li);
  }
}

function select(id: string) {
  selected = id;
  els.overlay.querySelectorAll(".box.selected").forEach((el) => el.classList.remove("selected"));
  els.overlay.querySelector(`[data-id="${id}"]`)?.classList.add("selected");
  showDetail();
}

function showDetail() {
  const icon = findIcon(selected);
  if (!icon || !sheet) {
    els.detail.innerHTML = `<p class="hint">Click a box on the sheet to inspect that icon.</p>`;
    return;
  }
  els.detail.replaceChildren();
  const c = crop(icon, 3, 320);
  c.className = "icon-crop";
  const h = document.createElement("h3");
  h.textContent = iconId(sheet.id, icon);
  const dl = document.createElement("dl");
  const add = (k: string, v: string) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  };
  add("Position", `${icon.x}, ${icon.y}`);
  add("Size", `${icon.w} by ${icon.h} px`);
  add("Anchor", `${icon.anchorX.toFixed(2)}, ${icon.anchorY.toFixed(2)}`);
  add("Flags", icon.flags.length ? icon.flags.join(", ").replaceAll("-", " ") : "none");
  els.detail.append(h, c, dl);
}

function findIcon(id: string | null): IconBox | undefined {
  if (!id || !result || !sheet) return;
  return result.rows.flatMap((r) => r.icons).find((i) => iconId(sheet!.id, i) === id);
}

// Copy part of the sheet into a small canvas, zoomed but no wider than maxW.
function crop(b: Box, zoom: number, maxW: number): HTMLCanvasElement {
  const z = Math.min(zoom, maxW / b.w);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(b.w * z));
  c.height = Math.max(1, Math.round(b.h * z));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = z < 1;
  const tmp = new OffscreenCanvas(b.w, b.h);
  tmp.getContext("2d")!.putImageData(sheet!.image, -b.x, -b.y, b.x, b.y, b.w, b.h);
  ctx.drawImage(tmp, 0, 0, c.width, c.height);
  return c;
}

function buildSettingsForm() {
  for (const f of FIELDS) {
    const label = document.createElement("label");
    label.title = f.help;
    label.innerHTML = `<span></span><input type="number" required>`;
    label.querySelector("span")!.textContent = f.label;
    const input = label.querySelector("input")!;
    input.name = f.key;
    input.min = String(f.min);
    input.max = String(f.max);
    input.value = String(settings[f.key]);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (!input.validity.valid || !Number.isFinite(v)) return;
      settings = { ...settings, [f.key]: v };
      rerun();
    });
    els.settings.append(label);
  }
}

function setStatus(text: string) {
  els.status.textContent = text;
}

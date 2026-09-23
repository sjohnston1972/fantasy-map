// Import page: drop a sheet, see it split into rows, titles and icons (milestone 1),
// then correct the boxes by hand (milestone 2). Everything runs in the browser;
// nothing is sent to the server yet.

import { createWorker, PSM } from "tesseract.js";
import type Tesseract from "tesseract.js";
import { cleanCategory, prepareTitle, TITLE_CHARS } from "./ocr";
import { DEFAULT_TRACE, MIN_PRINT_HEIGHT, medianHeight, type TraceSettings } from "./trace";
import { releaseEntry, traceSig, traceToEntry, type TraceEntry } from "./tracing";
import { DEFAULT_SETTINGS, iconId, makeInk, split, type Box, type Facing, type Ink, type SplitSettings } from "./split";
import {
  allIcons,
  deleteIcons,
  dismissExtras,
  findIcon,
  fromSplit,
  includeExtras,
  mergeIcons,
  neighbour,
  resizeIcon,
  clearIconTag,
  iconTags,
  inheritedTags,
  setIconTags,
  setRowTags,
  splitIcon,
  SCALES,
  type IconTags,
  type Kind,
  type Review,
  type ReviewIcon,
  type ReviewRow,
  type RowTags,
  type Scale,
} from "./review";

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

// One step of history: the boxes and the settings that produced them.
interface Snapshot {
  review: Review;
  settings: SplitSettings;
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

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
  rowTags: $<HTMLElement>("#row-tags"),
  status: $<HTMLElement>("#status"),
  merge: $<HTMLButtonElement>("#tool-merge"),
  split: $<HTMLButtonElement>("#tool-split"),
  del: $<HTMLButtonElement>("#tool-delete"),
  undo: $<HTMLButtonElement>("#tool-undo"),
  redo: $<HTMLButtonElement>("#tool-redo"),
  hint: $<HTMLElement>("#tool-hint"),
  trace: $<HTMLButtonElement>("#tool-trace"),
  progress: $<HTMLProgressElement>("#trace-progress"),
  resWarning: $<HTMLElement>("#res-warning"),
  viewSheet: $<HTMLButtonElement>("#view-sheet"),
  viewIcons: $<HTMLButtonElement>("#view-icons"),
  gallery: $<HTMLElement>("#gallery"),
  legend: $<HTMLElement>("#legend"),
  traceSettings: $<HTMLFormElement>("#trace-settings"),
  traceReset: $<HTMLButtonElement>("#trace-reset"),
};

let sheet: Sheet | null = null;
let settings: SplitSettings = { ...DEFAULT_SETTINGS };
let review: Review | null = null;
let splitMs = 0;
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
let selected: number[] = [];
let splitMode = false;

let inkCache: { key: string; ink: Ink } | null = null;
function ink(): Ink {
  const key = `${sheet!.id}:${settings.threshold}:${settings.padding}`;
  if (inkCache?.key !== key) inkCache = { key, ink: makeInk(sheet!.image, settings) };
  return inkCache.ink;
}

// Tracing state (milestone 4). Declared here, before the setup code below uses it.
let traceSettings: TraceSettings = { ...DEFAULT_TRACE };
const traces = new Map<number, TraceEntry>(); // by icon key
let tracing: { stop: boolean } | null = null;
let view: "sheet" | "icons" = "sheet";

const TRACE_FIELDS: { key: "turdsize" | "alphamax" | "opttolerance" | "level"; label: string; min: number; max: number; step: number; help: string }[] = [
  { key: "turdsize", label: "Speck size", min: 0, max: 100, step: 1, help: "Potrace turdsize: specks smaller than this many pixels are dropped" },
  { key: "alphamax", label: "Corner smoothing", min: 0, max: 1.34, step: 0.05, help: "Potrace alphamax: 0 keeps sharp corners, 1.3 rounds them" },
  { key: "opttolerance", label: "Curve joining", min: 0, max: 1, step: 0.05, help: "Potrace opttolerance: higher joins more curves, giving smaller files" },
  { key: "level", label: "Ink level", min: 1, max: 254, step: 1, help: "Grey level below which a pixel is traced as ink (the splitter uses its own threshold)" },
];

buildSettingsForm();
buildTraceSettingsForm();
els.trace.addEventListener("click", () => void traceAll());
els.viewSheet.addEventListener("click", () => setView("sheet"));
els.viewIcons.addEventListener("click", () => setView("icons"));
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
  syncSettingsForm();
  resplit();
});

els.merge.addEventListener("click", doMerge);
els.split.addEventListener("click", () => setSplitMode(!splitMode));
els.del.addEventListener("click", doDelete);
els.undo.addEventListener("click", undo);
els.redo.addEventListener("click", redo);
document.addEventListener("keydown", onKey);
els.overlay.addEventListener("pointerdown", onPointerDown);
els.overlay.addEventListener("pointermove", onSplitHover);
els.overlay.addEventListener("pointerleave", () => els.overlay.querySelector(".split-guide")?.remove());

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
  undoStack = [];
  redoStack = [];
  selected = [];
  review = null;
  clearTraces();
  upscaleChosen = false;
  resplit();
}

// Spec 8.2: sheet id is the first 16 hex characters of the file's SHA-256.
async function sheetId(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Re-split with the current settings. This replaces any manual edits, so the previous
// state goes on the undo stack. A short delay means typing "200" splits once, not three times.
let pending: ReturnType<typeof setTimeout> | undefined;
function resplit() {
  if (!sheet) return;
  clearTimeout(pending);
  pending = setTimeout(() => {
    const result = split(sheet!.image, settings);
    splitMs = result.ms;
    const next = fromSplit(result, ink());
    // Keep row tags when the rows still line up.
    if (review && review.rows.length === next.rows.length) {
      next.rows.forEach((row, i) => (row.tags = review!.rows[i].tags));
    }
    selected = []; // box keys start again from 1, so an old selection would point at the wrong box
    if (!upscaleChosen) {
      // Spec 7: small icons get the 4x upscale by default; print-size sheets do not need it.
      traceSettings = { ...traceSettings, upscale: medianHeight(allIcons(next)) < MIN_PRINT_HEIGHT };
      upscaleChosen = true;
    }
    commit(next, lastSettings ?? settings);
    lastSettings = { ...settings };
    void readTitles();
    setStatus(`Split into ${result.rows.length} rows and ${result.iconCount} icons.${undoStack.length ? " Undo brings back the previous boxes." : ""}`);
  }, 30);
}
let lastSettings: SplitSettings | null = null;
let upscaleChosen = false;

// Make an edit: remember the current state for undo, then show the new one.
function commit(next: Review, prevSettings: SplitSettings = settings) {
  if (next === review) return;
  if (review) undoStack.push({ review, settings: { ...prevSettings } });
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  review = next;
  selected = selected.filter((k) => findIcon(next, k));
  render();
}

function undo() {
  const prev = undoStack.pop();
  if (!prev || !review) return;
  redoStack.push({ review, settings: { ...settings } });
  restore(prev);
  setStatus("Undone.");
}

function redo() {
  const next = redoStack.pop();
  if (!next || !review) return;
  undoStack.push({ review, settings: { ...settings } });
  restore(next);
  setStatus("Redone.");
}

function restore(s: Snapshot) {
  review = s.review;
  settings = { ...s.settings };
  lastSettings = { ...settings };
  syncSettingsForm();
  selected = selected.filter((k) => findIcon(s.review, k));
  render();
}

function doMerge() {
  if (!review || selected.length < 2) return;
  const icons = selected.map((k) => findIcon(review!, k)!);
  if (new Set(icons.map((i) => i.row)).size > 1) return setStatus("Only boxes in the same row can be merged.");
  const before = review.nextKey;
  const next = mergeIcons(review, ink(), selected);
  selected = [before];
  commit(next);
  setStatus(`Merged ${icons.length} boxes.`);
}

function doDelete() {
  if (!review || !selected.length) return;
  const n = selected.length;
  const key = selected[0];
  const after = neighbour(review, key, "right") ?? neighbour(review, key, "left");
  const next = deleteIcons(review, selected);
  selected = after && !selected.includes(after) ? [after] : [];
  commit(next);
  setStatus(`Deleted ${n} ${n === 1 ? "box" : "boxes"}. Undo brings ${n === 1 ? "it" : "them"} back.`);
}

function doSplit(key: number, x: number) {
  if (!review) return;
  const before = review.nextKey;
  const next = splitIcon(review, ink(), key, x);
  if (next === review) return setStatus("That line does not have ink on both sides, so nothing was split.");
  selected = [before, before + 1];
  setSplitMode(false);
  commit(next);
  setStatus("Split into two boxes.");
}

function setSplitMode(on: boolean) {
  splitMode = on && selected.length === 1;
  els.stage.classList.toggle("splitting", splitMode);
  els.split.setAttribute("aria-pressed", String(splitMode));
  if (!splitMode) els.overlay.querySelector(".split-guide")?.remove();
  updateToolbar();
}

function select(keys: number[], scroll = false) {
  selected = keys;
  if (splitMode && keys.length !== 1) setSplitMode(false);
  if (view === "sheet") drawOverlay();
  else drawGallery();
  renderTags();
  updateToolbar();
  if (view === "icons" && scroll && keys.length) els.gallery.querySelector(`[data-key="${keys[0]}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (scroll && keys.length) els.overlay.querySelector(`[data-key="${keys[0]}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function onKey(e: KeyboardEvent) {
  if (!review) return;
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, select")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "z") {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (ctrl && e.key.toLowerCase() === "y") {
    e.preventDefault();
    return redo();
  }
  if (ctrl || e.altKey) return;
  const dirs: Record<string, "left" | "right" | "up" | "down"> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  if (dirs[e.key]) {
    e.preventDefault();
    const from = selected[selected.length - 1] ?? allIcons(review)[0]?.key;
    if (from === undefined) return;
    const to = selected.length ? neighbour(review, from, dirs[e.key]) : from;
    if (to !== undefined) select([to], true);
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    return doDelete();
  }
  if (e.key === "Enter") {
    // Spec 10: Enter opens the tag panel for the selected box, or the row's tags.
    e.preventDefault();
    return (document.getElementById(selected.length === 1 ? "it-category" : "rt-category") as HTMLInputElement | null)?.focus();
  }
  if (e.key === "m" || e.key === "M") return doMerge();
  if (e.key === "t" || e.key === "T") return void traceAll();
  if (e.key === "v" || e.key === "V") return setView(view === "sheet" ? "icons" : "sheet");
  if (e.key === "s" || e.key === "S") return setSplitMode(!splitMode);
  if (e.key === "Escape") return splitMode ? setSplitMode(false) : select([]);
}

// Image coordinates for a pointer event (the overlay is scaled to fit the page).
function toImage(e: { clientX: number; clientY: number }) {
  const r = els.overlay.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * sheet!.image.width, y: ((e.clientY - r.top) / r.height) * sheet!.image.height };
}
function imagePerScreenPx() {
  return sheet!.image.width / els.overlay.getBoundingClientRect().width;
}

function onPointerDown(e: PointerEvent) {
  if (!review || e.button !== 0) return;
  const target = e.target as SVGElement;
  const handle = target.dataset.handle as Handle | undefined;
  if (handle && !splitMode && selected.length === 1) return startResize(e, selected[0], handle);

  const key = Number(target.dataset.key);
  if (splitMode) {
    if (key === selected[0]) doSplit(key, Math.round(toImage(e).x));
    else setSplitMode(false);
    return;
  }
  if (!key) return select([]);
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    select(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  } else {
    select([key]);
  }
}

// Drag a handle to move that edge or corner; the box is saved when the pointer lifts.
function startResize(e: PointerEvent, key: number, handle: Handle) {
  e.preventDefault();
  const icon = findIcon(review!, key)!;
  const start = toImage(e);
  const rectEl = els.overlay.querySelector<SVGRectElement>(`rect[data-key="${key}"]`)!;
  let box: Box = { x: icon.x, y: icon.y, w: icon.w, h: icon.h };
  els.overlay.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const p = toImage(ev);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    let { x, y, w, h } = icon;
    if (handle.includes("w")) (x += dx), (w -= dx);
    if (handle.includes("e")) w += dx;
    if (handle.includes("n")) (y += dy), (h -= dy);
    if (handle.includes("s")) h += dy;
    box = { x, y, w, h };
    const n = normaliseBox(box);
    rectEl.setAttribute("x", String(n.x));
    rectEl.setAttribute("y", String(n.y));
    rectEl.setAttribute("width", String(n.w));
    rectEl.setAttribute("height", String(n.h));
    els.overlay.querySelectorAll(".handle, .anchor.selected-anchor").forEach((el) => el.remove());
  };
  const up = () => {
    els.overlay.removeEventListener("pointermove", move);
    els.overlay.removeEventListener("pointerup", up);
    els.overlay.removeEventListener("pointercancel", up);
    if (box.x !== icon.x || box.y !== icon.y || box.w !== icon.w || box.h !== icon.h) {
      commit(resizeIcon(review!, ink(), key, box));
      setStatus("Box resized.");
    } else {
      drawOverlay();
    }
  };
  els.overlay.addEventListener("pointermove", move);
  els.overlay.addEventListener("pointerup", up);
  els.overlay.addEventListener("pointercancel", up);
}

function normaliseBox(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
}

// In split mode, show where the cut would go.
function onSplitHover(e: PointerEvent) {
  if (!splitMode || !review) return;
  const icon = findIcon(review, selected[0]);
  let guide = els.overlay.querySelector<SVGLineElement>(".split-guide");
  const p = toImage(e);
  if (!icon || p.x <= icon.x || p.x >= icon.x + icon.w || p.y < icon.y || p.y > icon.y + icon.h) return guide?.remove();
  if (!guide) {
    guide = document.createElementNS(SVG_NS, "line");
    guide.setAttribute("class", "split-guide");
    els.overlay.append(guide);
  }
  const x = String(Math.round(p.x));
  guide.setAttribute("x1", x);
  guide.setAttribute("x2", x);
  guide.setAttribute("y1", String(icon.y));
  guide.setAttribute("y2", String(icon.y + icon.h));
}

function render() {
  if (!sheet || !review) return;
  const icons = allIcons(review);
  const untitled = review.rows.filter((row) => !row.title).length;
  const flagged = icons.filter((i) => i.flags.length || i.extras.length).length;
  const mismatched = review.rows.filter((row) => mismatch(row.icons.length)).length;
  els.summary.replaceChildren(
    stat("Sheet", sheet.filename, `id ${sheet.id}, ${sheet.image.width} by ${sheet.image.height} px`),
    stat("Rows", String(review.rows.length), untitled ? `${untitled} without a title` : "all titled"),
    stat("Icons", String(icons.length), flagged ? `${flagged} flagged for review` : "none flagged"),
    stat("Split time", `${Math.round(splitMs)} ms`, undoStack.length ? `${undoStack.length} edits so far` : "no edits yet"),
    stat("Traced", `${tracedCount()} of ${icons.length}`, traceSettings.upscale ? "enlarged 4x before tracing" : "at sheet size"),
  );
  if (mismatched) els.summary.append(stat("Check", `${mismatched} rows`, `not ${settings.expectedPerRow} icons`, true));
  drawResWarning();
  if (view === "sheet") drawOverlay();
  else drawGallery();
  renderTags();
  updateToolbar();
}

function mismatch(n: number) {
  return settings.expectedPerRow > 0 && n !== settings.expectedPerRow;
}

function stat(label: string, value: string, note: string, warn = false) {
  const d = document.createElement("div");
  d.className = warn ? "stat warn" : "stat";
  for (const [cls, text] of [["label", label], ["value", value], ["note", note]]) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    d.append(s);
  }
  return d;
}

function drawOverlay() {
  if (!review || !sheet) return;
  const svg = els.overlay;
  svg.replaceChildren();
  const px = imagePerScreenPx();
  for (const row of review.rows) {
    if (row.title) {
      const t = rect(row.title, "title", `Row ${row.index} title`);
      t.dataset.row = String(row.index);
      svg.append(t);
    }
    for (const icon of row.icons) {
      const id = iconId(sheet.id, icon);
      for (const extra of icon.extras) svg.append(rect(extra, "extra", `Mark left out of ${id}`));
      const kind = icon.flags.includes("auto-cut") ? "cut" : icon.flags.includes("possible-split") || icon.extras.length ? "split" : "icon";
      const el = rect(icon, kind, `${id}${icon.flags.length ? " (" + icon.flags.join(", ").replaceAll("-", " ") + ")" : ""}`);
      el.dataset.key = String(icon.key);
      if (selected.includes(icon.key)) el.classList.add("selected");
      svg.append(el);
      svg.append(anchorDot(icon, px));
    }
  }
  // Resize handles on a single selected box, a fixed size on screen whatever the zoom.
  if (selected.length === 1) {
    const icon = findIcon(review, selected[0]);
    if (icon) {
      // Bigger handles for fingers on tablets.
      const s = (matchMedia("(pointer: coarse)").matches ? 22 : 10) * px;
      const { x, y, w, h } = icon;
      const spots: [Handle, number, number][] = [
        ["nw", x, y], ["n", x + w / 2, y], ["ne", x + w, y],
        ["w", x, y + h / 2], ["e", x + w, y + h / 2],
        ["sw", x, y + h], ["s", x + w / 2, y + h], ["se", x + w, y + h],
      ];
      for (const [name, cx, cy] of spots) {
        const hEl = document.createElementNS(SVG_NS, "rect");
        hEl.setAttribute("x", String(cx - s / 2));
        hEl.setAttribute("y", String(cy - s / 2));
        hEl.setAttribute("width", String(s));
        hEl.setAttribute("height", String(s));
        hEl.setAttribute("class", `handle h-${name}`);
        hEl.dataset.handle = name;
        svg.append(hEl);
      }
    }
  }
}

function anchorDot(icon: ReviewIcon, px: number) {
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", String(icon.x + icon.anchorX * icon.w));
  dot.setAttribute("cy", String(icon.y + icon.anchorY * icon.h));
  dot.setAttribute("r", String(Math.max(1.5, 2.5 * px)));
  dot.setAttribute("class", "anchor");
  return dot;
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

function drawRowList() {
  if (!review || !sheet) return;
  els.rows.replaceChildren();
  const current = currentRow();
  for (const row of review.rows) {
    const li = document.createElement("li");
    li.className = `row${mismatch(row.icons.length) || !row.title ? " warn" : ""}${row.index === current ? " current" : ""}`;
    const head = document.createElement("div");
    head.className = "row-head";
    const num = document.createElement("button");
    num.type = "button";
    num.className = "row-num";
    num.textContent = `Row ${row.index}`;
    num.title = "Show this row's tags";
    num.addEventListener("click", () => selectRow(row.index));
    const count = document.createElement("span");
    count.textContent = `${row.icons.length} icons${mismatch(row.icons.length) ? `, expected ${settings.expectedPerRow}` : ""}`;
    head.append(num, count);
    li.append(head);
    if (row.title) {
      const c = crop(row.title, 2, 260);
      c.className = "title-crop";
      c.setAttribute("role", "img");
      c.setAttribute("aria-label", `Detected title for row ${row.index}`);
      li.append(c);
    } else {
      li.append(para("No title found", "missing"));
    }
    const cat = document.createElement("p");
    cat.className = "row-cat";
    const text = rowCategory(row);
    cat.textContent = text || "no category yet";
    if (!text) cat.classList.add("empty");
    const src = document.createElement("span");
    src.className = "source";
    src.textContent = row.tags.category !== null ? "typed" : ocrState(row) === "pending" ? "reading..." : text ? "read from title" : "";
    cat.append(" ", src);
    li.append(cat);
    els.rows.append(li);
  }
}

// The row whose tags are shown: the row of the selected box, or the last row clicked.
let chosenRow = 1;
function currentRow(): number {
  const icon = selected.length && review ? findIcon(review, selected[0]) : undefined;
  return icon ? icon.row : chosenRow;
}

function selectRow(index: number) {
  chosenRow = index;
  select([]);
  els.overlay.querySelector(`rect.title[data-row="${index}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  (document.getElementById("rt-category") as HTMLInputElement | null)?.focus();
}

function rowCategory(row: ReviewRow): string {
  return row.tags.category ?? ocrFor(row) ?? "";
}

// Spec 10: the selected row's tag panel. Every icon in the row inherits these.
function drawRowTags() {
  if (!review) return;
  const row = review.rows.find((r) => r.index === currentRow());
  els.rowTags.replaceChildren();
  if (!row) return;
  const heading = document.createElement("h2");
  heading.textContent = `Row ${row.index} tags`;
  const note = para(`Every icon in this row (${row.icons.length}) gets these tags unless it has its own.`, "hint small");
  const set = (patch: Partial<RowTags>) => commit(setRowTags(review!, row.index, patch));

  const cat = textField("rt-category", "Category", rowCategory(row), (v) => set({ category: v }));
  const pending = ocrState(row) === "pending";
  const catHint = row.tags.category === null ? (pending ? "Reading the title..." : ocrFor(row) ? "Read from the title. Type to change it." : "") : "";
  const sub = textField("rt-subtype", "Subtype", row.tags.subtype, (v) => set({ subtype: v }), "optional");
  const scales = scaleField("rt-scales", row.tags.scales, (v) => set({ scales: v }));
  const kind = kindField("rt-kind", row.tags.kind, (v) => set({ kind: v }));
  els.rowTags.append(heading, note, cat);
  if (catHint) els.rowTags.append(para(catHint, "hint small"));
  els.rowTags.append(sub, scales, kind);
}

function showDetail() {
  if (!review || !sheet) return;
  if (selected.length > 1) {
    const icons = selected.map((k) => findIcon(review!, k)).filter((i): i is ReviewIcon => !!i);
    const sameRow = new Set(icons.map((i) => i.row)).size === 1;
    els.detail.replaceChildren(
      para(`${icons.length} boxes selected.`),
      para(sameRow ? "Press M or the Merge button to join them into one box." : "These are in different rows, so they cannot be merged.", "hint"),
    );
    return;
  }
  const icon = selected.length ? findIcon(review, selected[0]) : undefined;
  if (!icon) {
    els.detail.replaceChildren(para("Click a box on the sheet to inspect, edit or tag it. Shift-click to select more than one.", "hint"));
    return;
  }
  const row = review.rows.find((r) => r.index === icon.row)!;
  const ocr = ocrFor(row) ?? "";
  const tags = iconTags(row, icon, ocr);
  const from = inheritedTags(row, icon, ocr);
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
  add("Size", `${icon.w} by ${icon.h} px`);
  add("Anchor", `${icon.anchorX.toFixed(2)}, ${icon.anchorY.toFixed(2)}`);
  add("Flags", icon.flags.length ? icon.flags.join(", ").replaceAll("-", " ") : "none");
  els.detail.append(h, c, dl, traceDetail(icon));

  // Tags for this icon: each field shows the row's value until changed here.
  const box = document.createElement("div");
  box.className = "icon-tags";
  box.append(para("Tags for this icon", "sub"));
  const set = (patch: Partial<IconTags>) => commit(setIconTags(review!, icon.key, patch, ocr));
  const own = (f: keyof IconTags) => f in icon.overrides;
  const wrap = (f: keyof IconTags, el: HTMLElement, rowValue: string) => {
    const d = document.createElement("div");
    d.className = own(f) ? "tag-field own" : "tag-field";
    d.append(el);
    const s = document.createElement("div");
    s.className = "tag-source";
    if (own(f)) {
      s.append(`This icon only. ${f === "facing" ? "Guess was" : "Row says"}: ${rowValue || "(blank)"} `);
      s.append(linkButton(f === "facing" ? "Use the guess" : "Use row value", () => commit(clearIconTag(review!, icon.key, f))));
    } else if (f === "facing") {
      s.textContent = icon.autoFacing === "none" ? "Guessed from the drawing: not clearly facing either way" : "Guessed from the drawing (auto), check it";
    } else {
      s.textContent = "From the row";
    }
    d.append(s);
    return d;
  };
  box.append(
    wrap("category", textField("it-category", "Category", tags.category, (v) => set({ category: v })), from.category),
    wrap("subtype", textField("it-subtype", "Subtype", tags.subtype, (v) => set({ subtype: v }), "optional"), from.subtype),
    wrap("scales", scaleField("it-scales", tags.scales, (v) => set({ scales: v })), from.scales.join(", ")),
    wrap("kind", kindField("it-kind", tags.kind, (v) => set({ kind: v })), from.kind),
    wrap("facing", facingField("it-facing", tags.facing, (v) => set({ facing: v })), from.facing),
  );
  els.detail.append(box);

  if (icon.extras.length) {
    const ex = document.createElement("div");
    ex.className = "extras";
    ex.append(para(`${icon.extras.length} nearby ${icon.extras.length === 1 ? "mark was" : "marks were"} left out of this box (dashed outline).`));
    ex.append(
      button("Include them", () => commit(includeExtras(review!, ink(), icon.key))),
      button("Leave them out", () => commit(dismissExtras(review!, icon.key))),
    );
    els.detail.append(ex);
  }
}

// Form controls for tags. Text saves when the field loses focus or Enter is pressed.
function textField(id: string, label: string, value: string, onSave: (v: string) => void, placeholder = "") {
  const l = document.createElement("label");
  l.className = "field";
  const s = document.createElement("span");
  s.textContent = label;
  const i = document.createElement("input");
  i.type = "text";
  i.id = id;
  i.value = value;
  i.placeholder = placeholder;
  i.autocomplete = "off";
  i.spellcheck = false;
  i.addEventListener("change", () => {
    const v = i.value.trim().toLowerCase();
    if (v !== value) onSave(v);
  });
  i.addEventListener("keydown", (e) => e.key === "Enter" && i.blur());
  l.append(s, i);
  return l;
}

function scaleField(id: string, value: Scale[], onSave: (v: Scale[]) => void) {
  const f = document.createElement("fieldset");
  f.className = "field choices";
  f.id = id;
  const lg = document.createElement("legend");
  lg.textContent = "Scale";
  f.append(lg);
  for (const s of SCALES) {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.id = `${id}-${s}`;
    c.checked = value.includes(s);
    c.addEventListener("change", () => {
      const next = SCALES.filter((x) => (x === s ? c.checked : value.includes(x)));
      if (!next.length) {
        c.checked = true; // an icon must be usable at some scale
        return setStatus("Pick at least one scale.");
      }
      onSave(next);
    });
    l.append(c, ` ${s}`);
    f.append(l);
  }
  return f;
}

function kindField(id: string, value: Kind, onSave: (v: Kind) => void) {
  return choiceField(id, "Kind", ["point", "pattern"] as Kind[], value, onSave, { point: "point (placed once)", pattern: "pattern (tiled)" });
}

function facingField(id: string, value: Facing, onSave: (v: Facing) => void) {
  return choiceField(id, "Facing", ["left", "right", "none"] as Facing[], value, onSave);
}

function choiceField<T extends string>(id: string, label: string, options: T[], value: T, onSave: (v: T) => void, names: Partial<Record<T, string>> = {}) {
  const f = document.createElement("fieldset");
  f.className = "field choices";
  f.id = id;
  const lg = document.createElement("legend");
  lg.textContent = label;
  f.append(lg);
  for (const o of options) {
    const l = document.createElement("label");
    const r = document.createElement("input");
    r.type = "radio";
    r.name = id;
    r.id = `${id}-${o}`;
    r.checked = o === value;
    r.addEventListener("change", () => {
      if (r.checked && o !== value) onSave(o);
    });
    l.append(r, ` ${names[o] ?? o}`);
    f.append(l);
  }
  return f;
}

function linkButton(text: string, onClick: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "link";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

// Spec 5: read each row title with OCR in the background. OCR is a convenience: if it
// fails, the category stays blank and can be typed.
const ocrResults = new Map<string, string>();
const ocrPending = new Set<string>();
let ocrWorker: Promise<Tesseract.Worker> | null = null;
let ocrFailed = false;

function ocrKey(box: Box) {
  return `${sheet!.id}:${box.x},${box.y},${box.w},${box.h}`;
}

function ocrFor(row: ReviewRow): string | undefined {
  return row.title ? ocrResults.get(ocrKey(row.title)) : undefined;
}

function ocrState(row: ReviewRow): "done" | "pending" | "none" {
  if (!row.title) return "none";
  const k = ocrKey(row.title);
  return ocrResults.has(k) ? "done" : ocrPending.has(k) ? "pending" : "none";
}

function startOcrWorker() {
  const base = new URL("ocr/", location.href).href;
  return createWorker("eng", 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    workerBlobURL: false,
    gzip: true,
  }).then(async (w) => {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: TITLE_CHARS });
    return w;
  });
}

let ocrRun = 0;
async function readTitles() {
  if (!review || !sheet || ocrFailed) return;
  const run = ++ocrRun;
  const rows = review.rows.filter((r) => r.title && !ocrResults.has(ocrKey(r.title)));
  if (!rows.length) return;
  for (const r of rows) ocrPending.add(ocrKey(r.title!));
  renderTags();
  try {
    ocrWorker ??= startOcrWorker();
    const worker = await ocrWorker;
    let done = 0;
    for (const r of rows) {
      if (run !== ocrRun) return; // a newer split has started its own pass
      const key = ocrKey(r.title!);
      const p = prepareTitle(sheet.image, r.title!);
      const canvas = new OffscreenCanvas(p.width, p.height);
      canvas.getContext("2d")!.putImageData(new ImageData(p.data, p.width, p.height), 0, 0);
      const { data } = await worker.recognize(await canvas.convertToBlob({ type: "image/png" }));
      ocrResults.set(key, cleanCategory(data.text));
      ocrPending.delete(key);
      done++;
      setStatus(`Reading row titles: ${done} of ${rows.length}.`);
      renderTags();
    }
    setStatus(`Read ${rows.length} row titles. Check the categories and correct any mistakes.`);
  } catch (err) {
    ocrFailed = true;
    ocrPending.clear();
    renderTags();
    setStatus("Could not read the row titles automatically. Type each row's category instead.");
    console.warn("OCR failed", err);
  }
}

// Redraw just the parts that show tags, keeping keyboard focus where it was.
function renderTags() {
  const focus = document.activeElement?.id;
  drawRowList();
  drawRowTags();
  showDetail();
  if (focus) document.getElementById(focus)?.focus();
}

function para(text: string, cls = "") {
  const p = document.createElement("p");
  if (cls) p.className = cls;
  p.textContent = text;
  return p;
}

function button(text: string, onClick: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ghost small";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function updateToolbar() {
  const icons = review ? selected.map((k) => findIcon(review!, k)).filter((i): i is ReviewIcon => !!i) : [];
  const sameRow = icons.length >= 2 && new Set(icons.map((i) => i.row)).size === 1;
  els.merge.disabled = !sameRow;
  els.split.disabled = icons.length !== 1;
  els.del.disabled = icons.length === 0;
  els.undo.disabled = undoStack.length === 0;
  els.redo.disabled = redoStack.length === 0;
  els.trace.textContent = tracing ? "Stop tracing" : review && tracedCount() === allIcons(review).length ? "All traced" : tracedCount() ? "Trace the rest" : "Trace all icons";
  els.trace.disabled = !tracing && !!review && tracedCount() === allIcons(review).length;
  els.hint.textContent = splitMode
    ? "Click inside the selected box where the cut should go. Esc cancels."
    : icons.length === 1
      ? "Drag the square handles to resize. S splits, Delete removes, arrow keys move to the next box."
      : icons.length > 1
        ? "M merges the selected boxes. Delete removes them."
        : "Click a box to select it. Shift-click adds more boxes to the selection.";
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
    const span = document.createElement("span");
    span.textContent = f.label;
    const input = document.createElement("input");
    input.type = "number";
    input.required = true;
    input.name = f.key;
    input.min = String(f.min);
    input.max = String(f.max);
    input.value = String(settings[f.key]);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (!input.validity.valid || !Number.isFinite(v)) return;
      settings = { ...settings, [f.key]: v };
      if (f.key === "expectedPerRow") return render(); // only changes the warnings
      resplit();
    });
    label.append(span, input);
    els.settings.append(label);
  }
}

function syncSettingsForm() {
  for (const f of FIELDS) (els.settings.elements.namedItem(f.key) as HTMLInputElement).value = String(settings[f.key]);
}

function setStatus(text: string) {
  els.status.textContent = text;
}

// Keep handles and dots a sensible size when the window is resized.
window.addEventListener("resize", () => view === "sheet" && drawOverlay());

// ---- Tracing (milestone 4, spec 7) ----

function traceState(icon: ReviewIcon): "done" | "stale" | "none" {
  const t = traces.get(icon.key);
  if (!t) return "none";
  return t.sig === traceSig(icon, traceSettings) ? "done" : "stale";
}

function tracedCount(): number {
  return review ? allIcons(review).filter((i) => traceState(i) === "done").length : 0;
}

async function traceOne(icon: ReviewIcon) {
  const old = traces.get(icon.key);
  const entry = await traceToEntry(sheet!.image, icon, traceSettings);
  if (old) releaseEntry(old);
  traces.set(icon.key, entry);
}

// Spec 3 step 5: trace every icon that has no up-to-date trace, with a progress bar.
async function traceAll() {
  if (!review || !sheet) return;
  if (tracing) {
    tracing.stop = true;
    return;
  }
  const todo = allIcons(review).filter((i) => traceState(i) !== "done");
  if (!todo.length) return setStatus("Every icon is already traced.");
  const run = { stop: false };
  tracing = run;
  els.progress.hidden = false;
  els.progress.max = todo.length;
  updateToolbar();
  const t0 = performance.now();
  let done = 0;
  try {
    for (const icon of todo) {
      if (run.stop || !review || !findIcon(review, icon.key)) break;
      await traceOne(icon);
      done++;
      els.progress.value = done;
      setStatus(`Tracing: ${done} of ${todo.length}.`);
      if (done % 4 === 0 || done === todo.length) {
        drawGallery();
        await yieldToPage();
      }
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(run.stop ? `Stopped after tracing ${done} icons.` : `Traced ${done} icons in ${secs} s. Compare each PNG and SVG before approving.`);
  } catch (err) {
    console.warn("Tracing failed", err);
    setStatus("Tracing failed. Try again, or reload the page.");
  } finally {
    tracing = null;
    els.progress.hidden = true;
    render();
  }
}

// Spec 7: warn when the icons are too small for print, and offer the 4x upscale.
function drawResWarning() {
  if (!review) return;
  const median = medianHeight(allIcons(review));
  els.resWarning.hidden = median >= MIN_PRINT_HEIGHT;
  if (els.resWarning.hidden) return;
  els.resWarning.replaceChildren();
  const p = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = "Screen quality only. ";
  p.append(
    strong,
    `The typical icon on this sheet is ${median} px tall; printing at A3 needs at least ${MIN_PRINT_HEIGHT} px. ` +
      `Enlarging 4x before tracing gives smoother outlines, though it cannot add detail the sheet does not have.`,
  );
  const l = document.createElement("label");
  const c = document.createElement("input");
  c.type = "checkbox";
  c.id = "upscale";
  c.checked = traceSettings.upscale;
  c.addEventListener("change", () => {
    traceSettings = { ...traceSettings, upscale: c.checked };
    render();
  });
  l.append(c, " Enlarge 4x (bicubic) before tracing");
  els.resWarning.append(p, l);
}

function buildTraceSettingsForm() {
  for (const f of TRACE_FIELDS) {
    const label = document.createElement("label");
    label.title = f.help;
    const span = document.createElement("span");
    span.textContent = f.label;
    const input = document.createElement("input");
    input.type = "number";
    input.required = true;
    input.name = f.key;
    input.min = String(f.min);
    input.max = String(f.max);
    input.step = String(f.step);
    input.value = String(traceSettings[f.key]);
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (!input.validity.valid || !Number.isFinite(v)) return;
      traceSettings = { ...traceSettings, [f.key]: v };
      setStatus("Trace settings changed. Traced icons are now out of date; trace again to update them.");
      render();
    });
    label.append(span, input);
    els.traceSettings.append(label);
  }
  els.traceSettings.addEventListener("submit", (e) => e.preventDefault());
  els.traceReset.addEventListener("click", () => {
    traceSettings = { ...DEFAULT_TRACE, upscale: traceSettings.upscale };
    for (const f of TRACE_FIELDS) (els.traceSettings.elements.namedItem(f.key) as HTMLInputElement).value = String(traceSettings[f.key]);
    render();
  });
}

// PNG and SVG side by side for one icon, on a checkerboard so transparency shows.
function comparePair(icon: ReviewIcon, big: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = big ? "pair big" : "pair";
  const t = traces.get(icon.key);
  const state = traceState(icon);
  if (!t || state === "none") {
    wrap.classList.add("empty");
    wrap.append(para("Not traced yet", "hint small"));
    return wrap;
  }
  for (const [label, url] of [["PNG", t.pngUrl], ["SVG", t.svgUrl]]) {
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = url;
    img.alt = `${label} of ${iconId(sheet!.id, icon)}`;
    img.draggable = false;
    const cap = document.createElement("figcaption");
    cap.textContent = label;
    fig.append(img, cap);
    wrap.append(fig);
  }
  if (state === "stale") {
    wrap.classList.add("stale");
    wrap.append(para("Out of date: the box or trace settings changed", "stale-note"));
  }
  return wrap;
}

function traceDetail(icon: ReviewIcon): HTMLElement {
  const box = document.createElement("div");
  box.className = "trace-detail";
  box.append(para("Traced result", "sub"), comparePair(icon, true));
  const t = traces.get(icon.key);
  const state = traceState(icon);
  if (t && state === "done") {
    box.append(para(`${t.width} by ${t.height} px, ${t.nodes} path commands, SVG ${(t.svg.length / 1024).toFixed(1)} KB`, "hint small"));
  }
  if (state !== "done") {
    box.append(
      button(state === "stale" ? "Trace again" : "Trace this icon", async () => {
        await traceOne(icon);
        render();
      }),
    );
  }
  return box;
}

// The "Traced icons" view: every icon's PNG and SVG, row by row.
function drawGallery() {
  if (!review || !sheet || view !== "icons") return;
  els.gallery.replaceChildren();
  for (const row of review.rows) {
    const sec = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = `Row ${row.index}: ${rowCategory(row) || "no category"}`;
    const grid = document.createElement("div");
    grid.className = "cards";
    for (const icon of row.icons) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `card ${traceState(icon)}${selected.includes(icon.key) ? " selected" : ""}`;
      card.dataset.key = String(icon.key);
      card.append(comparePair(icon, false));
      const cap = document.createElement("span");
      cap.className = "card-id";
      cap.textContent = `r${icon.row} c${icon.col}`;
      card.append(cap);
      card.addEventListener("click", () => select([icon.key]));
      grid.append(card);
    }
    sec.append(h, grid);
    els.gallery.append(sec);
  }
}

function setView(v: "sheet" | "icons") {
  view = v;
  els.viewSheet.setAttribute("aria-pressed", String(v === "sheet"));
  els.viewIcons.setAttribute("aria-pressed", String(v === "icons"));
  els.stage.hidden = v !== "sheet";
  els.legend.hidden = v !== "sheet";
  els.gallery.hidden = v !== "icons";
  if (v === "icons") drawGallery();
  else drawOverlay();
}

function clearTraces() {
  for (const t of traces.values()) releaseEntry(t);
  traces.clear();
}

// Give the page a moment to redraw. A message-channel hop is not slowed down in
// background tabs the way setTimeout is.
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

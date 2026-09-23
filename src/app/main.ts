// The public map page: generate a map from its settings, draw it in ink, let the visitor
// make light edits, and export it. Everything runs in the visitor's browser.

import { generate, type GeneratedMap } from "../gen/pipeline";
import { renderRelief } from "../gen/render";
import { toInkSet, type InkSet, type InkSymbol } from "../gen/inkset";
import { drawingOf, renderSvg } from "../gen/svg";
import { applyEdits, editCount, move, NO_EDITS, remove, rename, swap, type EditedMap, type Edits } from "../gen/edits";
import { embeddedFontCss, pngSize, saveBlob, svgToPng } from "./export";
import { randomSeed } from "../gen/rng";
import { cleanSettings, DEFAULT_SETTINGS, type MapSettings } from "../gen/settings";

// A-paper proportions (1 by the square root of 2), so a map prints on A3 or A4 exactly.
const SHAPES: Record<string, [number, number]> = {
  portrait: [1600, 2263],
  landscape: [2263, 1600],
};

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const els = {
  form: $<HTMLFormElement>("#settings"),
  seed: $<HTMLInputElement>("#seed"),
  shape: $<HTMLSelectElement>("#shape"),
  sea: $<HTMLInputElement>("#sea"),
  seaOut: $<HTMLOutputElement>("#sea-out"),
  mountains: $<HTMLInputElement>("#mountains"),
  mountainsOut: $<HTMLOutputElement>("#mountains-out"),
  map: $<HTMLElement>("#map"),
  mapBox: $<HTMLElement>("#map-box"),
  relief: $<HTMLCanvasElement>("#relief"),
  showRelief: $<HTMLInputElement>("#show-relief"),
  caption: $<HTMLElement>("#caption"),
  editMode: $<HTMLButtonElement>("#edit-mode"),
  editTools: $<HTMLElement>("#edit-tools"),
  swap: $<HTMLButtonElement>("#swap"),
  del: $<HTMLButtonElement>("#delete"),
  undo: $<HTMLButtonElement>("#undo"),
  rename: $<HTMLFormElement>("#rename"),
  labelText: $<HTMLInputElement>("#label-text"),
  editHint: $<HTMLElement>("#edit-hint"),
  exportSvg: $<HTMLButtonElement>("#export-svg"),
  exportPng: $<HTMLButtonElement>("#export-png"),
  exportA3: $<HTMLButtonElement>("#export-a3"),
  exportStatus: $<HTMLOutputElement>("#export-status"),
};

let settings: MapSettings = { ...DEFAULT_SETTINGS };
let current: GeneratedMap | null = null;
let ink: InkSet | undefined; // hand-inked symbols, once the packs have loaded
// Light editing: the changes made on top of the generated map, the earlier versions of
// those changes (for undo), and the item currently picked.
let edits: Edits = NO_EDITS;
let history: Edits[] = [];
let edited: EditedMap | null = null;
let selected: string | null = null;
let editing = false;

// Redraw once for a burst of changes while a slider is dragged. A message-channel hop is
// used rather than an animation frame, which browsers pause in background tabs.
let queued = false;
const tick = new MessageChannel();
let pendingDraw: () => void = () => {};
tick.port1.onmessage = () => pendingDraw();
syncForm();
draw();
void loadInk();

// Symbol packs load in the background (spec: "symbol packs load in the background"). The
// map is drawn at once with placeholder shapes, then redrawn with the ink symbols.
async function loadInk() {
  try {
    const manifest = (await (await fetch("/api/packs/manifest.json")).json()) as { packs: Record<string, string> };
    const packs = await Promise.all(
      Object.values(manifest.packs).map(async (name) => (await (await fetch(`/api/packs/${name}`)).json()) as { role: string; symbols: InkSymbol[] }),
    );
    ink = toInkSet(packs);
    if (current) paint(current);
  } catch (err) {
    console.warn("Symbol packs did not load; keeping placeholder symbols.", err);
  }
}

// Generate draws a new map. If a different seed has been typed in, that seed is drawn
// instead, so a map someone liked can be brought back.
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (Number(els.seed.value) === settings.seed) els.seed.value = String(randomSeed());
  readForm();
  draw();
});
// Sliders and the shape redraw as they change; the seed redraws on Enter or Generate.
for (const input of [els.sea, els.mountains]) input.addEventListener("input", () => (readForm(), draw()));
els.shape.addEventListener("change", () => (readForm(), draw()));
els.showRelief.addEventListener("change", () => current && paintRelief(current));

function readForm() {
  const [width, height] = SHAPES[els.shape.value] ?? SHAPES.portrait;
  settings = cleanSettings({
    ...settings,
    seed: Number(els.seed.value),
    width,
    height,
    sea_level: Number(els.sea.value) / 100,
    mountain_density: Number(els.mountains.value) / 100,
  });
  syncForm();
}

function syncForm() {
  els.seed.value = String(settings.seed);
  els.shape.value = Object.keys(SHAPES).find((k) => SHAPES[k][0] === settings.width && SHAPES[k][1] === settings.height) ?? "portrait";
  els.sea.value = String(Math.round(settings.sea_level * 100));
  els.seaOut.value = `${els.sea.value}% water`;
  els.mountains.value = String(Math.round(settings.mountain_density * 100));
  els.mountainsOut.value = `${els.mountains.value}%`;
}

function draw() {
  if (queued) return;
  queued = true;
  tick.port2.postMessage(null);
  pendingDraw = () => {
    queued = false;
    const t0 = performance.now();
    const map = generate(settings);
    // A new map starts with no edits; they belong to the map they were made on.
    edits = NO_EDITS;
    history = [];
    selected = null;
    paint(map);
    // A short fade-in, so every redraw is visible even when little changes.
    els.map.classList.remove("fresh");
    void els.map.offsetWidth;
    els.map.classList.add("fresh");
    const ms = Math.round(performance.now() - t0);
    const w = map.water;
    const t = map.towns;
    els.caption.textContent = `Seed ${map.settings.seed}: ${t.places.length} settlements, ${t.roads.length} roads, ${t.bridges.length} bridges, ${w.rivers.length} rivers, ${w.lakes} ${w.lakes === 1 ? "lake" : "lakes"}. Generated in ${ms} ms.`;
  };
}

function svgFor(map: EditedMap, fontCss?: string): string {
  const { width, height } = map.settings;
  return renderSvg({ width, height, water: map.water, symbols: map.symbols, towns: map.towns, labels: map.labels, ink, fontCss });
}

function paint(map: GeneratedMap) {
  current = map;
  edited = applyEdits(map, edits);
  const { width, height } = map.settings;
  els.mapBox.style.aspectRatio = `${width} / ${height}`;
  els.map.innerHTML = svgFor(edited);
  const svg = els.map.querySelector("svg")!;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Map for seed ${map.settings.seed}: coast, rivers, lakes, mountains, hills and forests in black ink.`);
  paintRelief(map);
  showSelection();
}

// Optional shaded relief laid over the ink drawing, to check the terrain underneath.
function paintRelief(map: GeneratedMap) {
  els.relief.hidden = !els.showRelief.checked;
  if (els.relief.hidden) return;
  const { cols, rows } = map.height;
  els.relief.width = cols;
  els.relief.height = rows;
  els.relief.getContext("2d")!.putImageData(new ImageData(renderRelief(map.height, map.landSea, map.water), cols, rows), 0, 0);
}

// ---- Light editing ----
// Edit mode is switched on with a button so that, on a tablet, dragging the map scrolls
// the page until the visitor chooses to edit.

els.editMode.addEventListener("click", () => {
  editing = !editing;
  els.editMode.setAttribute("aria-pressed", String(editing));
  els.editMode.textContent = editing ? "Finish editing" : "Edit the map";
  els.editTools.hidden = !editing;
  els.map.classList.toggle("editing", editing);
  if (!editing) select(null);
  else els.map.focus();
});

function commit(next: Edits) {
  if (next === edits || !current) return;
  history.push(edits);
  edits = next;
  paint(current);
}

els.undo.addEventListener("click", undo);
function undo() {
  const prev = history.pop();
  if (!prev || !current) return;
  edits = prev;
  paint(current);
}

els.del.addEventListener("click", () => selected && commit(remove(edits, selected)));
els.swap.addEventListener("click", swapSelected);
function swapSelected() {
  if (!selected || !edited) return;
  const d = drawingOf(edited, selected);
  if (d) commit(swap(edits, selected, d.variant, ink?.[d.role]?.length ?? 0));
}

els.rename.addEventListener("submit", (e) => {
  e.preventDefault();
  if (selected?.startsWith("label:")) commit(rename(edits, selected, els.labelText.value));
  els.map.focus();
});

function itemEl(key: string): SVGGraphicsElement | null {
  return els.map.querySelector<SVGGraphicsElement>(`[data-key="${key}"]`);
}

function select(key: string | null) {
  selected = key;
  showSelection();
}

// Mark the picked item and set the tools to suit it.
function showSelection() {
  for (const el of els.map.querySelectorAll(".selected")) el.classList.remove("selected");
  const el = selected ? itemEl(selected) : null;
  if (!el) selected = null;
  el?.classList.add("selected");
  const isLabel = !!selected?.startsWith("label:");
  const d = selected && edited ? drawingOf(edited, selected) : null;
  els.del.disabled = !selected;
  els.swap.disabled = !d || (ink?.[d.role]?.length ?? 0) < 2;
  els.undo.disabled = history.length === 0;
  els.rename.hidden = !isLabel;
  if (isLabel) els.labelText.value = edited?.labels.labels.find((l) => `label:${l.id}` === selected)?.text ?? "";
  const n = editCount(edits);
  els.editHint.textContent = selected
    ? isLabel
      ? "Drag to move, change the wording below, or press Delete."
      : `Drag to move, press S to swap the drawing, or Delete to remove it.`
    : `Click a symbol, town or name to pick it.${n ? ` ${n} ${n === 1 ? "change" : "changes"} so far.` : ""}`;
}

// Drag to move. The item follows the pointer as a preview; the move is recorded on release.
let drag: { key: string; el: SVGGraphicsElement; x: number; y: number; scale: number; base: string; dx: number; dy: number } | null = null;

els.map.addEventListener("pointerdown", (e) => {
  if (!editing || e.button !== 0) return;
  const el = (e.target as Element).closest<SVGGraphicsElement>("[data-key]");
  if (!el) return select(null);
  const key = el.dataset.key!;
  select(key);
  const svg = els.map.querySelector("svg")!;
  const scale = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
  drag = { key, el, x: e.clientX, y: e.clientY, scale, base: el.getAttribute("transform") ?? "", dx: 0, dy: 0 };
  els.map.setPointerCapture(e.pointerId);
  e.preventDefault();
});

els.map.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.dx = (e.clientX - drag.x) * drag.scale;
  drag.dy = (e.clientY - drag.y) * drag.scale;
  drag.el.setAttribute("transform", `translate(${drag.dx.toFixed(1)} ${drag.dy.toFixed(1)}) ${drag.base}`.trim());
});

const endDrag = () => {
  if (!drag) return;
  const { key, dx, dy, scale } = drag;
  drag = null;
  // Ignore the tiny wobble of a click.
  if (Math.hypot(dx, dy) > 3 * scale) commit(move(edits, key, dx, dy));
};
els.map.addEventListener("pointerup", endDrag);
els.map.addEventListener("pointercancel", endDrag);

els.map.addEventListener("dblclick", () => {
  if (editing && selected?.startsWith("label:")) els.labelText.select();
});

// Keyboard: N and Shift+N step through the items, arrows nudge, S swaps, Delete removes,
// Escape lets go, and Ctrl+Z undoes.
document.addEventListener("keydown", (e) => {
  if (!editing) return;
  const typing = e.target instanceof Element && !!e.target.closest("input, select, textarea");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    return undo();
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const step = e.shiftKey ? 16 : 4;
  const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (e.key.toLowerCase() === "n") {
    const keys = [...els.map.querySelectorAll<SVGElement>("[data-key]")].map((el) => el.dataset.key!);
    if (!keys.length) return;
    const at = selected ? keys.indexOf(selected) : -1;
    select(keys[(at + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]);
  } else if (e.key === "Escape") select(null);
  else if (!selected) return;
  else if (e.key === "Delete" || e.key === "Backspace") commit(remove(edits, selected));
  else if (e.key.toLowerCase() === "s") swapSelected();
  else if (nudge[e.key]) commit(move(edits, selected, ...nudge[e.key]));
  else return;
  e.preventDefault();
});

// ---- Export ----

els.exportSvg.addEventListener("click", () =>
  exporting("Saving the SVG", async (map) => {
    const svg = svgFor(map, await embeddedFontCss());
    saveBlob(new Blob([svg], { type: "image/svg+xml" }), `ink-map-${map.settings.seed}.svg`);
  }),
);
for (const [button, kind] of [[els.exportPng, "screen"], [els.exportA3, "a3"]] as const) {
  button.addEventListener("click", () =>
    exporting(kind === "a3" ? "Drawing the A3 print PNG" : "Drawing the PNG", async (map) => {
      const [w, h] = pngSize(kind, map.settings.width, map.settings.height);
      const png = await svgToPng(svgFor(map, await embeddedFontCss()), w, h);
      saveBlob(png, `ink-map-${map.settings.seed}${kind === "a3" ? "-a3" : ""}.png`);
    }),
  );
}

async function exporting(what: string, job: (map: EditedMap) => Promise<void>) {
  if (!edited) return;
  const buttons = [els.exportSvg, els.exportPng, els.exportA3];
  buttons.forEach((b) => (b.disabled = true));
  els.exportStatus.value = `${what}...`;
  try {
    await job(edited);
    els.exportStatus.value = "Saved.";
  } catch (err) {
    console.error(err);
    els.exportStatus.value = `Sorry, that did not work: ${(err as Error).message}`;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

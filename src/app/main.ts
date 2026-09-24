// The public map page: generate a map from its settings, draw it in ink, let the visitor
// make light edits, and export it. Everything runs in the visitor's browser.

import { generate, type GeneratedMap } from "../gen/pipeline";
import { renderRelief } from "../gen/render";
import { toInkSet, type InkSet, type InkSymbol } from "../gen/inkset";
import { asDrawing, drawingOf, frameFor, renderSvg } from "../gen/svg";
import { addSymbol, applyEdits, editCount, isSymbolKey, layer, move, NO_EDITS, remove, rename, swap, type AddedSymbol, type EditedMap, type Edits, type LayerMove } from "../gen/edits";
import { embeddedFontCss, pngSize, saveBlob, svgToPng, svgToThumb, toBase64 } from "./export";
import { saveMyMap } from "./mymaps";
import { drawnBox, MapZoom, MAX_ZOOM, previewTransform, type View } from "./zoom";
import { decodeEdits, decodeSettings, encodeEdits, encodeSettings, fingerprint } from "./share";
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
  forest: $<HTMLInputElement>("#forest"),
  forestOut: $<HTMLOutputElement>("#forest-out"),
  towns: $<HTMLInputElement>("#towns"),
  townsOut: $<HTMLOutputElement>("#towns-out"),
  shareLink: $<HTMLInputElement>("#share-link"),
  copyLink: $<HTMLButtonElement>("#copy-link"),
  shareStatus: $<HTMLOutputElement>("#share-status"),
  mapName: $<HTMLInputElement>("#map-name"),
  saveMine: $<HTMLButtonElement>("#save-mine"),
  publish: $<HTMLButtonElement>("#publish"),
  keepStatus: $<HTMLOutputElement>("#keep-status"),
  map: $<HTMLElement>("#map"),
  mapBox: $<HTMLElement>("#map-box"),
  relief: $<HTMLCanvasElement>("#relief"),
  showRelief: $<HTMLInputElement>("#show-relief"),
  caption: $<HTMLElement>("#caption"),
  editMode: $<HTMLButtonElement>("#edit-mode"),
  editTools: $<HTMLElement>("#edit-tools"),
  swap: $<HTMLButtonElement>("#swap"),
  del: $<HTMLButtonElement>("#delete"),
  forward: $<HTMLButtonElement>("#forward"),
  backward: $<HTMLButtonElement>("#backward"),
  undo: $<HTMLButtonElement>("#undo"),
  rename: $<HTMLFormElement>("#rename"),
  labelText: $<HTMLInputElement>("#label-text"),
  editHint: $<HTMLElement>("#edit-hint"),
  exportSvg: $<HTMLButtonElement>("#export-svg"),
  exportPng: $<HTMLButtonElement>("#export-png"),
  exportA3: $<HTMLButtonElement>("#export-a3"),
  exportStatus: $<HTMLOutputElement>("#export-status"),
  zoomIn: $<HTMLButtonElement>("#zoom-in"),
  zoomOut: $<HTMLButtonElement>("#zoom-out"),
  zoomFit: $<HTMLButtonElement>("#zoom-fit"),
  zoomLevel: $<HTMLOutputElement>("#zoom-level"),
  addOpen: $<HTMLButtonElement>("#add-open"),
  copy: $<HTMLButtonElement>("#copy"),
  cut: $<HTMLButtonElement>("#cut"),
  paste: $<HTMLButtonElement>("#paste"),
  selectArea: $<HTMLButtonElement>("#select-area"),
  palette: $<HTMLElement>("#palette"),
  palRole: $<HTMLSelectElement>("#pal-role"),
  palSize: $<HTMLInputElement>("#pal-size"),
  palSizeOut: $<HTMLOutputElement>("#pal-size-out"),
  palVary: $<HTMLInputElement>("#pal-vary"),
  palMix: $<HTMLInputElement>("#pal-mix"),
  palGrid: $<HTMLElement>("#pal-grid"),
  palHint: $<HTMLElement>("#pal-hint"),
  palDone: $<HTMLButtonElement>("#pal-done"),
};

// Zoom and pan (src/app/zoom.ts). The view survives redraws of the same map size, so a
// slider can be tried on the part of the map being looked at.
const zoom = new MapZoom(els.map, applyView, previewView);

// A share link (?map=code) opens the map it names; otherwise the page starts on a new seed.
const params = new URLSearchParams(location.search);
const shared = decodeSettings(params.get("map") ?? "");
let settings: MapSettings = shared?.settings ?? { ...DEFAULT_SETTINGS, seed: randomSeed() };
let current: GeneratedMap | null = null;
let ink: InkSet | undefined; // hand-inked symbols, once the packs have loaded
// Light editing: the changes made on top of the generated map, the earlier versions of
// those changes (for undo), and the item currently picked.
let edits: Edits = NO_EDITS;
let undoStack: Edits[] = [];
let edited: EditedMap | null = null;
let picked: string[] = []; // keys of the picked items; the last is the one acted on alone
let editing = false;
// Edits carried by the link, applied to the first map drawn.
let linkEdits: Edits | null = shared ? await decodeEdits(params.get("e") ?? "") : null;
const badLinkEdits = !!shared && !!params.get("e") && !linkEdits;

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
for (const input of [els.sea, els.mountains, els.forest, els.towns]) input.addEventListener("input", () => (readForm(), draw()));
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
    forest_density: Number(els.forest.value) / 100,
    town_count: Number(els.towns.value),
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
  els.forest.value = String(Math.round(settings.forest_density * 100));
  els.forestOut.value = `${els.forest.value}%`;
  els.towns.value = String(settings.town_count);
  els.townsOut.value = els.towns.value;
}

function draw() {
  if (queued) return;
  queued = true;
  tick.port2.postMessage(null);
  pendingDraw = () => {
    queued = false;
    const t0 = performance.now();
    const map = generate(settings);
    if (!current || current.settings.width !== map.settings.width || current.settings.height !== map.settings.height) zoom.reset(map.settings.width, map.settings.height);
    // A new map starts with no edits; they belong to the map they were made on.
    edits = linkEdits ?? NO_EDITS;
    linkEdits = null;
    undoStack = [];
    picked = [];
    paint(map);
    // A short fade-in, so every redraw is visible even when little changes.
    els.map.classList.remove("fresh");
    void els.map.offsetWidth;
    els.map.classList.add("fresh");
    const ms = Math.round(performance.now() - t0);
    const w = map.water;
    const t = map.towns;
    // The fingerprint is taken from the plain drawing (no ink packs, no edits), so it is the
    // same for everyone who opens the same link.
    const print = fingerprint(renderSvg({ width: map.settings.width, height: map.settings.height, water: map.water, symbols: map.symbols, towns: map.towns, labels: map.labels }));
    els.caption.textContent = `Seed ${map.settings.seed}: ${t.places.length} settlements, ${t.roads.length} roads, ${t.bridges.length} bridges, ${w.rivers.length} rivers, ${w.lakes} ${w.lakes === 1 ? "lake" : "lakes"}. Drawn in ${ms} ms. Map check ${print}.`;
    void updateLink();
    // Suggest the capital's name as the map's name; a new map clears any typed name.
    els.mapName.value = "";
    els.mapName.placeholder = map.labels.labels.find((l) => l.kind === "capital")?.text ?? `Map ${map.settings.seed}`;
    confirmPublish = false;
    els.publish.textContent = "Publish to the public gallery";
    els.keepStatus.textContent = "";
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
  applyView(zoom.view);
  showSelection();
}

// Show the zoomed view: the SVG's window onto the map, the relief lined up with it, and the
// zoom controls' state.
function applyView(v: View) {
  const svg = els.map.querySelector("svg");
  if (svg) {
    svg.style.transform = "";
    const b = drawnBox(v);
    svg.setAttribute("viewBox", `${b.x.toFixed(2)} ${b.y.toFixed(2)} ${b.w.toFixed(2)} ${b.h.toFixed(2)}`);
  }
  els.relief.style.visibility = "";
  positionRelief();
  showZoomState();
}

// Mid-gesture: move the picture already drawn instead of redrawing the map.
function previewView(drawn: View, live: View) {
  const svg = els.map.querySelector("svg");
  if (!svg) return;
  const r = els.map.getBoundingClientRect();
  const t = previewTransform(drawn, live, r.width, r.height);
  svg.style.transform = `scale(${t.k}) translate3d(${t.tx}px, ${t.ty}px, 0)`;
  els.relief.style.visibility = "hidden"; // shown again, lined up, when the map is redrawn
  showZoomState();
}

function showZoomState() {
  const level = zoom.level;
  els.zoomLevel.value = `${Math.round(level * 100)}%`;
  els.zoomIn.disabled = level >= MAX_ZOOM - 0.001;
  els.zoomOut.disabled = els.zoomFit.disabled = level <= 1.0001;
  els.map.classList.toggle("zoomed", level > 1.0001);
}

// Line the relief up with the drawing inside the frame, at the current zoom.
function positionRelief() {
  if (els.relief.hidden || !current) return;
  const { width: W, height: H } = current.settings;
  const fr = frameFor(W, H);
  const v = zoom.view;
  Object.assign(els.relief.style, {
    left: `${((fr.dx - v.x) / v.w) * 100}%`,
    top: `${((fr.dy - v.y) / v.h) * 100}%`,
    width: `${((W * fr.scale) / v.w) * 100}%`,
    height: `${((H * fr.scale) / v.h) * 100}%`,
  });
}

// Optional shaded relief laid over the ink drawing, to check the terrain underneath.
function paintRelief(map: GeneratedMap) {
  els.relief.hidden = !els.showRelief.checked;
  if (els.relief.hidden) return;
  const { cols, rows } = map.height;
  els.relief.width = cols;
  els.relief.height = rows;
  els.relief.getContext("2d")!.putImageData(new ImageData(renderRelief(map.height, map.landSea, map.water), cols, rows), 0, 0);
  positionRelief();
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
  if (!editing) {
    select(null);
    closePalette();
  }
  else els.map.focus();
});

function commit(next: Edits) {
  if (next === edits || !current) return;
  undoStack.push(edits);
  edits = next;
  paint(current);
  void updateLink();
}

els.undo.addEventListener("click", undo);
function undo() {
  const prev = undoStack.pop();
  if (!prev || !current) return;
  edits = prev;
  paint(current);
  void updateLink();
}

// ---- Picking one or several items ----
// Click picks one item; Shift-click (or Ctrl-click) adds or removes items; Shift-drag across
// an empty part of the map (or "Select area" then drag, on touch screens) picks everything
// in the box. Moving, deleting, swapping and layering apply to all the picked items at
// once, as one undo step.

const primary = () => picked[picked.length - 1] ?? null;

// Apply one change to every picked item, as a single step.
function forPicked(change: (e: Edits, key: string) => Edits, keys: string[] = picked) {
  const next = keys.reduce(change, edits);
  commit(next);
  return next;
}

els.del.addEventListener("click", () => deletePicked());
function deletePicked() {
  if (!picked.length) return;
  forPicked(remove);
  picked = [];
  showSelection();
}
els.swap.addEventListener("click", swapSelected);
// Shift-click goes all the way to the front or back.
els.forward.addEventListener("click", (e) => layerSelected(e.shiftKey ? "front" : "forward"));
els.backward.addEventListener("click", (e) => layerSelected(e.shiftKey ? "back" : "backward"));
function layerSelected(how: LayerMove) {
  const keys = picked.filter(isSymbolKey);
  if (!keys.length || !current) return;
  const map = current;
  // Bringing forward, the front-most goes first so the group keeps its own order.
  const order = how === "forward" || how === "front" ? [...keys].reverse() : keys;
  const next = order.reduce((e, key) => layer(map, e, key, how), edits);
  if (next === edits) {
    els.editHint.textContent = how === "forward" || how === "front" ? "Already in front of everything it touches." : "Already behind everything it touches.";
    return;
  }
  commit(next);
}
function swapSelected() {
  if (!picked.length || !edited) return;
  const map = edited;
  forPicked((e, key) => {
    const d = drawingOf(map, key);
    return d ? swap(e, key, d.variant, ink?.[d.role]?.length ?? 0) : e;
  });
}

els.rename.addEventListener("submit", (e) => {
  e.preventDefault();
  const key = primary();
  if (picked.length === 1 && key?.startsWith("label:")) commit(rename(edits, key, els.labelText.value));
  els.map.focus();
});

function itemEl(key: string): SVGGraphicsElement | null {
  return els.map.querySelector<SVGGraphicsElement>(`[data-key="${key}"]`);
}

// Pick exactly this item (or nothing).
function select(key: string | null) {
  picked = key ? [key] : [];
  showSelection();
}

// Add an item to the picked set, or take it out if it is already in.
function togglePick(key: string) {
  picked = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
  showSelection();
}

// Mark the picked items and set the tools to suit them.
function showSelection() {
  for (const el of els.map.querySelectorAll(".selected")) el.classList.remove("selected");
  picked = picked.filter((key) => {
    const el = itemEl(key);
    el?.classList.add("selected");
    return !!el;
  });
  const one = picked.length === 1 ? picked[0] : null;
  const isLabel = !!one?.startsWith("label:");
  const swappable = picked.some((key) => {
    const d = edited ? drawingOf(edited, key) : null;
    return !!d && (ink?.[d.role]?.length ?? 0) >= 2;
  });
  els.del.disabled = !picked.length;
  els.forward.disabled = els.backward.disabled = !picked.some(isSymbolKey);
  els.swap.disabled = !swappable;
  els.copy.disabled = els.cut.disabled = !picked.some((key) => !key.startsWith("label:"));
  els.paste.disabled = !clipboard.length;
  els.undo.disabled = undoStack.length === 0;
  els.rename.hidden = !isLabel;
  if (isLabel) els.labelText.value = edited?.labels.labels.find((l) => `label:${l.id}` === one)?.text ?? "";
  const n = editCount(edits);
  els.editHint.textContent =
    picked.length > 1
      ? `${picked.length} items picked. Drag any of them to move them all; Delete, S, ] and [ apply to all; Ctrl+C copies.`
      : one
        ? isLabel
          ? "Drag to move, change the wording below, or press Delete. Shift-click to pick more."
          : isSymbolKey(one)
            ? "Drag to move, S swaps the drawing, ] brings it in front of what it overlaps and [ sends it behind (Shift for all the way), Delete removes it. Shift-click to pick more."
            : "Drag to move, press S to swap the drawing, or Delete to remove it. Shift-click to pick more."
        : `Click a symbol, town or name to pick it; Shift-drag across the map to pick several.${n ? ` ${n} ${n === 1 ? "change" : "changes"} so far.` : ""}`;
}

// ---- Dragging ----
// A pointer on an item (in edit mode) drags it, with the rest of the picked items; a
// Shift-drag on empty map (or any drag while "Select area" is on) draws a picking box;
// anywhere else a drag pans the zoomed map; a second finger turns any of them into a pinch.
let drag: { pointer: number; x: number; y: number; scale: number; items: { key: string; el: SVGGraphicsElement; base: string }[]; dx: number; dy: number } | null = null;
let box: { pointer: number; x: number; y: number; add: boolean; el: HTMLElement } | null = null;
let areaMode = false;

function cancelDrag() {
  if (!drag) return;
  for (const it of drag.items) {
    if (it.base) it.el.setAttribute("transform", it.base);
    else it.el.removeAttribute("transform");
  }
  drag = null;
}

function cancelBox() {
  box?.el.remove();
  box = null;
}

els.selectArea.addEventListener("click", () => setAreaMode(!areaMode));
function setAreaMode(on: boolean) {
  areaMode = on;
  els.selectArea.setAttribute("aria-pressed", String(on));
  els.map.classList.toggle("area", on);
}

els.map.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  lastPointer = { x: e.clientX, y: e.clientY };
  if (zoom.pinching || (drag && drag.pointer !== e.pointerId) || (box && box.pointer !== e.pointerId)) {
    cancelDrag();
    cancelBox();
    zoom.down(e);
    e.preventDefault();
    return;
  }
  if (editing && placing) {
    zoom.track(e);
    placeAt(e.clientX, e.clientY);
    e.preventDefault();
    return;
  }
  const el = editing ? (e.target as Element).closest<SVGGraphicsElement>("[data-key]") : null;
  const adding = e.shiftKey || e.ctrlKey || e.metaKey;
  // Picking box: Shift-drag on empty map, or a drag in "Select area" mode that does not
  // start on an already picked item (those drag the group, as always).
  const onPicked = !!el && picked.includes(el.dataset.key!);
  if (editing && ((adding && !el) || (areaMode && !onPicked))) {
    zoom.track(e);
    const div = document.createElement("div");
    div.className = "pick-box";
    els.mapBox.append(div);
    box = { pointer: e.pointerId, x: e.clientX, y: e.clientY, add: adding, el: div };
    capture(e);
    e.preventDefault();
    return;
  }
  if (!el) {
    if (editing) select(null);
    if (zoom.down(e)) {
      els.map.classList.add("panning");
      e.preventDefault();
    }
    return;
  }
  zoom.track(e);
  const key = el.dataset.key!;
  if (adding) {
    togglePick(key);
    e.preventDefault();
    return;
  }
  if (!picked.includes(key)) select(key);
  const svg = els.map.querySelector("svg")!;
  // Screen pixels to map pixels: the zoomed view, and the frame's slight shrink inside it.
  const { width: W, height: H } = current!.settings;
  const scale = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width / frameFor(W, H).scale;
  const items = picked.flatMap((k) => {
    const it = itemEl(k);
    return it ? [{ key: k, el: it, base: it.getAttribute("transform") ?? "" }] : [];
  });
  drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY, scale, items, dx: 0, dy: 0 };
  capture(e);
  e.preventDefault();
});

function capture(e: PointerEvent) {
  try {
    els.map.setPointerCapture(e.pointerId);
  } catch {
    // The pointer has already gone; the gesture still ends on pointerup.
  }
}

els.map.addEventListener("pointermove", (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (!drag && !box && zoom.move(e)) return;
  if (box && box.pointer === e.pointerId) {
    const r = els.mapBox.getBoundingClientRect();
    const [x0, x1] = [Math.min(box.x, e.clientX), Math.max(box.x, e.clientX)];
    const [y0, y1] = [Math.min(box.y, e.clientY), Math.max(box.y, e.clientY)];
    Object.assign(box.el.style, { left: `${x0 - r.left}px`, top: `${y0 - r.top}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    return;
  }
  if (!drag || drag.pointer !== e.pointerId) return;
  drag.dx = (e.clientX - drag.x) * drag.scale;
  drag.dy = (e.clientY - drag.y) * drag.scale;
  for (const it of drag.items) it.el.setAttribute("transform", `translate(${drag.dx.toFixed(1)} ${drag.dy.toFixed(1)}) ${it.base}`.trim());
});

const endDrag = (e: PointerEvent) => {
  zoom.up(e);
  if (!zoom.pinching) els.map.classList.remove("panning");
  if (box && box.pointer === e.pointerId) {
    const r = box.el.getBoundingClientRect();
    cancelBox();
    // Everything whose drawing overlaps the box is picked.
    if (r.width > 3 || r.height > 3) {
      const inside = [...els.map.querySelectorAll<SVGGraphicsElement>("[data-key]")]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width + b.height > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        })
        .map((el) => el.dataset.key!);
      picked = [...new Set([...(e.shiftKey || e.ctrlKey || e.metaKey ? picked : []), ...inside])];
      showSelection();
    }
    // "Select area" is for one box: switch it off so the next drag moves what was picked.
    setAreaMode(false);
    return;
  }
  if (!drag || drag.pointer !== e.pointerId) return;
  const { items, dx, dy, scale } = drag;
  drag = null;
  // Ignore the tiny wobble of a click.
  if (Math.hypot(dx, dy) > 3 * scale) forPicked((ed, key) => move(ed, key, dx, dy), items.map((it) => it.key));
};
els.map.addEventListener("pointerup", endDrag);
els.map.addEventListener("pointercancel", endDrag);

els.map.addEventListener("dblclick", (e) => {
  const key = primary();
  if (editing && picked.length === 1 && key?.startsWith("label:")) els.labelText.select();
  else if (!editing) zoom.zoomBy(2, zoom.toMap(e.clientX, e.clientY));
});

els.map.addEventListener("wheel", (e) => zoom.wheel(e), { passive: false });
els.zoomIn.addEventListener("click", () => zoom.zoomBy(1.5));
els.zoomOut.addEventListener("click", () => zoom.zoomBy(1 / 1.5));
els.zoomFit.addEventListener("click", () => zoom.zoomBy(1 / MAX_ZOOM));

// Zoom keys work anywhere on the page except in text boxes: + and - zoom, 0 shows the whole
// map. Arrow keys look around a zoomed map when it has focus and nothing is picked.
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
  const pan: Record<string, [number, number]> = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] };
  if (e.key === "+" || e.key === "=") zoom.zoomBy(1.5);
  else if (e.key === "-" || e.key === "_") zoom.zoomBy(1 / 1.5);
  else if (e.key === "0") zoom.zoomBy(1 / MAX_ZOOM);
  else if (pan[e.key] && e.target === els.map && zoom.level > 1.0001 && !(editing && picked.length)) zoom.pan(...pan[e.key]);
  else return;
  e.preventDefault();
});

// Keyboard: N and Shift+N step through the items, arrows nudge, S swaps, ] and [ layer
// (Shift for all the way), Delete removes, Escape lets go, Ctrl+Z undoes, and Ctrl+C,
// Ctrl+X and Ctrl+V copy, cut and paste.
document.addEventListener("keydown", (e) => {
  if (!editing) return;
  const typing = e.target instanceof Element && !!e.target.closest("input, select, textarea");
  if (typing) return;
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "z") undo();
    else if (k === "c") {
      if (!copyPicked()) return; // nothing to copy: leave the browser's own copy alone
    }
    else if (k === "x") cutPicked();
    else if (k === "v") pasteClipboard();
    else if (k === "a") pickAllSymbols();
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  const step = e.shiftKey ? 16 : 4;
  const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (e.key.toLowerCase() === "n") {
    const keys = [...els.map.querySelectorAll<SVGElement>("[data-key]")].map((el) => el.dataset.key!);
    if (!keys.length) return;
    const at = primary() ? keys.indexOf(primary()!) : -1;
    select(keys[(at + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]);
  } else if (e.key === "Escape") {
    if (placing) closePalette();
    else select(null);
  } else if (!picked.length) return;
  else if (e.key === "Delete" || e.key === "Backspace") deletePicked();
  else if (e.key.toLowerCase() === "s") swapSelected();
  else if (e.code === "BracketRight") layerSelected(e.shiftKey ? "front" : "forward");
  else if (e.code === "BracketLeft") layerSelected(e.shiftKey ? "back" : "backward");
  else if (nudge[e.key]) forPicked((ed, key) => move(ed, key, ...nudge[e.key]));
  else return;
  e.preventDefault();
});

// Ctrl+A in edit mode picks every symbol in view (not towns or names), to move or delete a
// whole patch at once.
function pickAllSymbols() {
  const r = els.map.getBoundingClientRect();
  picked = [...els.map.querySelectorAll<SVGGraphicsElement>("[data-key^='sym:'], [data-key^='add:']")]
    .filter((el) => {
      const b = el.getBoundingClientRect();
      return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
    })
    .map((el) => el.dataset.key!);
  showSelection();
}

// ---- Copy and paste ----
// Copies are kept on this page (not the system clipboard) as drawings placed relative to
// their middle, so a group keeps its layout. They survive generating a new map, so a
// favourite cluster can be carried to another map. Names are not copied.

let clipboard: AddedSymbol[] = [];
let lastPointer: { x: number; y: number } | null = null;

els.copy.addEventListener("click", copyPicked);
els.cut.addEventListener("click", cutPicked);
els.paste.addEventListener("click", () => pasteClipboard(true));

function copyPicked(): boolean {
  if (!edited || !current) return false;
  const map = { width: current.settings.width, symbols: edited.symbols, towns: edited.towns, labels: edited.labels, ink };
  // Keep the drawing order: generated symbols, then added ones, as drawn.
  const order = new Map(edited.symbols.map((s, i) => [s.key, i]));
  const keys = [...picked].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  const items = keys.flatMap((key) => {
    const d = asDrawing(map, key);
    return d ? [d] : [];
  });
  if (!items.length) return false;
  const cx = items.reduce((s, d) => s + d.x, 0) / items.length;
  const cy = items.reduce((s, d) => s + d.y, 0) / items.length;
  clipboard = items.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy }));
  els.paste.disabled = false;
  els.editHint.textContent = `Copied ${items.length} ${items.length === 1 ? "item" : "items"}. Point at the map and press Ctrl+V (or Paste) to place a copy.`;
  return true;
}

function cutPicked() {
  if (copyPicked()) deletePicked();
}

// Paste centred on the pointer if it is over the map (else the middle of the view). The
// copies become the picked items, ready to drag into place.
function pasteClipboard(fromButton = false) {
  if (!clipboard.length || !current) return;
  const { width: W, height: H } = current.settings;
  const fr = frameFor(W, H);
  const r = els.map.getBoundingClientRect();
  const over = !fromButton && lastPointer && lastPointer.x >= r.left && lastPointer.x <= r.right && lastPointer.y >= r.top && lastPointer.y <= r.bottom;
  const p = over ? zoom.toMap(lastPointer!.x, lastPointer!.y) : { x: zoom.view.x + zoom.view.w / 2, y: zoom.view.y + zoom.view.h / 2 };
  const cx = (p.x - fr.dx) / fr.scale;
  const cy = (p.y - fr.dy) / fr.scale;
  let next = edits;
  const keys: string[] = [];
  for (const d of clipboard) {
    const added = addSymbol(next, { ...d, x: d.x + cx, y: d.y + cy });
    next = added.edits;
    keys.push(added.key);
  }
  commit(next);
  picked = keys;
  setAreaMode(false);
  showSelection();
}

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

// ---- Share link ----
// The address bar always holds the current map's link, so copying the address shares it too.

// Links are rebuilt after every change; a newer rebuild wins if two overlap.
let linkRun = 0;
async function updateLink() {
  if (!current) return;
  const run = ++linkRun;
  const e = await encodeEdits(edits);
  if (run !== linkRun) return;
  const url = new URL(location.href);
  url.search = `?map=${encodeSettings(current.settings)}${e ? `&e=${e}` : ""}`;
  url.hash = "";
  history.replaceState(null, "", url);
  els.shareLink.value = url.href;
}

if (badLinkEdits) els.shareStatus.value = "The edits in this link could not be read, so the map is shown without them.";

if (shared && shared.version !== DEFAULT_SETTINGS.v) {
  els.shareStatus.value = "This link was made with a different version of the generator, so the map may differ slightly.";
}

els.copyLink.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.shareLink.value);
    els.shareStatus.value = "Link copied.";
  } catch {
    // Clipboard access can be refused; leave the link selected to copy by hand.
    els.shareLink.select();
    els.shareStatus.value = "Press Ctrl+C (or Cmd+C) to copy the selected link.";
  }
});
els.shareLink.addEventListener("focus", () => els.shareLink.select());

// ---- My maps and the public gallery ----

let confirmPublish = false;

els.saveMine.addEventListener("click", () => keepMap("mine"));
els.publish.addEventListener("click", () => {
  // Publishing is public, so the first press explains and the second one publishes.
  if (!confirmPublish) {
    confirmPublish = true;
    els.publish.textContent = "Yes, publish it";
    els.keepStatus.textContent = "This shows the map, its name and a small picture to everyone who visits the gallery. Press again to publish.";
    return;
  }
  confirmPublish = false;
  els.publish.textContent = "Publish to the public gallery";
  void keepMap("public");
});

async function keepMap(where: "mine" | "public") {
  if (!edited || !current) return;
  const map = edited;
  const name = (els.mapName.value.trim() || els.mapName.placeholder).slice(0, 60);
  const buttons = [els.saveMine, els.publish];
  buttons.forEach((b) => (b.disabled = true));
  els.keepStatus.textContent = "Drawing a small picture of the map...";
  try {
    const { width, height } = map.settings;
    const thumb = new Uint8Array(await (await svgToThumb(svgFor(map, await embeddedFontCss()), width, height)).arrayBuffer());
    const code = encodeSettings(map.settings);
    const e = await encodeEdits(edits);
    if (where === "mine") {
      saveMyMap({ name, code, edits: e, thumb: `data:image/jpeg;base64,${toBase64(thumb)}` });
      showKept(`Saved "${name}" to My maps. `, "/gallery/#mine", "See My maps");
    } else {
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, edits: e, thumb: toBase64(thumb) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `the server said ${res.status}`);
      showKept(`Published "${name}". `, "/gallery/#everyone", "See the gallery");
    }
  } catch (err) {
    els.keepStatus.textContent = `Sorry, that did not work: ${(err as Error).message}`;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function showKept(text: string, href: string, linkText: string) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = linkText;
  els.keepStatus.replaceChildren(text, a);
}

// ---- Adding symbols from the library ----
// The palette lists every drawing in the symbol packs, by kind. Pick one, then click the
// map to place it; each click places another, so a forest or a range builds up quickly.
// "Vary size and facing" gives each copy a slightly different size and a random facing, as
// a hand-inked map would have; "Mix drawings" also picks any drawing of the kind each time.

// Kinds in the order a mapmaker reaches for them, and their usual width in map pixels on a
// 1600-pixel-wide map (the generator's sizes, see src/gen/symbols.ts and svg.ts).
const ADD_KINDS: [string, string, number][] = [
  ["mountain", "Mountains", 80],
  ["hill", "Hills", 40],
  ["conifer", "Pine trees", 13],
  ["broadleaf", "Leafy trees", 15],
  ["field", "Fields", 17],
  ["reeds", "Reeds", 12],
  ["grass", "Grass", 9],
  ["dune", "Dunes", 33],
  ["cactus", "Cactus", 8],
  ["snow", "Snow", 15],
  ["village", "Villages", 40],
  ["town", "Towns", 56],
  ["capital", "Cities", 74],
  ["landmark", "Landmarks", 30],
  ["bridge", "Bridges", 24],
  ["emblem", "Banners", 30],
];

let placing: { role: string; index: number } | null = null;

els.addOpen.addEventListener("click", () => (els.palette.hidden ? openPalette() : closePalette()));
els.palDone.addEventListener("click", closePalette);
els.palRole.addEventListener("change", () => {
  placing = null;
  fillGrid();
});
els.palSize.addEventListener("input", () => (els.palSizeOut.value = `${els.palSize.value}%`));

function openPalette() {
  if (!ink) {
    els.editHint.textContent = "The symbol drawings are still loading; try again in a moment.";
    return;
  }
  els.palette.hidden = false;
  els.addOpen.setAttribute("aria-expanded", "true");
  const kinds = ADD_KINDS.filter(([role]) => ink?.[role]?.length);
  if (!els.palRole.options.length) {
    els.palRole.replaceChildren(...kinds.map(([role, label]) => new Option(`${label} (${ink![role].length})`, role)));
  }
  fillGrid();
  els.palRole.focus();
}

function closePalette() {
  placing = null;
  els.palette.hidden = true;
  els.addOpen.setAttribute("aria-expanded", "false");
  els.map.classList.remove("placing");
}

// One button per drawing of the chosen kind, showing the drawing itself.
function fillGrid() {
  const role = els.palRole.value;
  const list = ink?.[role] ?? [];
  els.palGrid.replaceChildren(
    ...list.map((icon, index) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pal-item";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", "false");
      b.setAttribute("aria-label", `${role} drawing ${index + 1}`);
      // Pack drawings come from this site's own symbol library.
      b.innerHTML = `<svg viewBox="${icon.viewBox}" aria-hidden="true" color="#1a1714">${icon.body}</svg>`;
      b.addEventListener("click", () => choose(role, index));
      return b;
    }),
  );
  els.palHint.textContent = "Pick a drawing, then click the map to place it. Keep clicking to place more; press Done or Escape to stop.";
}

function choose(role: string, index: number) {
  placing = placing?.role === role && placing.index === index ? null : { role, index };
  for (const [i, b] of [...els.palGrid.children].entries()) b.setAttribute("aria-selected", String(!!placing && i === index));
  els.map.classList.toggle("placing", !!placing);
  if (placing) els.palHint.textContent = "Now click the map where it should stand. Each click places another.";
}

// Place the chosen drawing with its base centred a little below the pointer, so it looks
// centred on the click.
function placeAt(clientX: number, clientY: number) {
  if (!placing || !current || !ink) return;
  const list = ink[placing.role];
  if (!list?.length) return;
  // The picked drawing, unless "Mix drawings" asks for any drawing of the kind.
  const vary = els.palVary.checked;
  const index = els.palMix.checked ? Math.floor(Math.random() * list.length) : placing.index;
  const icon = list[index];
  const { width: W, height: H } = current.settings;
  const fr = frameFor(W, H);
  const p = zoom.toMap(clientX, clientY); // page pixels
  const mx = (p.x - fr.dx) / fr.scale; // map pixels
  const my = (p.y - fr.dy) / fr.scale;
  const base = ADD_KINDS.find(([r]) => r === placing!.role)?.[2] ?? 30;
  const w = base * (W / 1600) * (Number(els.palSize.value) / 100) * (vary ? 0.85 + Math.random() * 0.3 : 1);
  const h = (w * icon.h) / icon.w;
  const { edits: next, key } = addSymbol(edits, { role: placing.role, x: mx, y: my + h / 2, w, h, variant: (index + 0.5) / list.length, flip: vary ? Math.random() < 0.5 : false });
  commit(next);
  select(key);
}

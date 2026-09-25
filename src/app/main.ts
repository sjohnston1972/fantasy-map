// The public map page: generate a map from its settings, draw it in ink, let the visitor
// make light edits, and export it. Everything runs in the visitor's browser.
//
// This file starts the page (reading a share link), runs the settings form, and draws the
// map. The rest of the page is in these modules:
//   dom.ts        the page's elements, looked up once
//   state.ts      what the modules share: the map, its edits, the picked items, the zoom
//   ink.ts        loading the symbol drawings, and the pre-drawn pictures used on screen
//   history.ts    recording a change, undo and redo, redrawing only what changed
//   selection.ts  picking items, and the box and action bar around them
//   gestures.ts   dragging, picking boxes, and panning and zooming with the pointer
//   keys.ts       the keyboard
//   clipboard.ts  copy, cut and paste
//   resize.ts     resizing by the box's corners, Smaller and Bigger
//   actions.ts    edit mode, Swap, Forward, Back, Delete, and rewording names
//   palette.ts    Add symbols
//   panels.ts     saving files, the share link, My maps and the public gallery
//   zoom.ts, sprites.ts, export.ts, share.ts, mymaps.ts: helpers used by the above

import { applyEdits, NO_EDITS, type EditedMap } from "../gen/edits";
import { generate, type GeneratedMap } from "../gen/pipeline";
import { renderRelief } from "../gen/render";
import { randomSeed } from "../gen/rng";
import { cleanSettings, DEFAULT_SETTINGS, GENERATOR_VERSION, type Border, type Coast, type MapSettings } from "../gen/settings";
import { frameFor, renderSvg, type SeaStyle } from "../gen/svg";
import { initActions } from "./actions";
import { initClipboard } from "./clipboard";
import { els } from "./dom";
import { initGestures } from "./gestures";
import { initHistory } from "./history";
import { loadInk, spritesWanted } from "./ink";
import { initKeys } from "./keys";
import { initPalette } from "./palette";
import { initPanels, updateLink } from "./panels";
import { initResize } from "./resize";
import { placeSelBox, showSelection } from "./selection";
import { decodeEdits, decodeSettings, fingerprint } from "./share";
import { state } from "./state";
import { drawnBox, MapZoom, MAX_ZOOM, previewTransform, type View } from "./zoom";

// A-paper proportions (1 by the square root of 2), so a map prints on A3 or A4 exactly.
const SHAPES: Record<string, [number, number]> = {
  portrait: [1600, 2263],
  landscape: [2263, 1600],
};

// Zoom and pan (src/app/zoom.ts). The view survives redraws of the same map size, so a
// slider can be tried on the part of the map being looked at.
state.zoom = new MapZoom(els.map, applyView, previewView);
// The shaded relief is hidden while the map moves and shown again on a redraw, so with it
// on, every move ends in a redraw.
state.zoom.canSkipRedraw = () => els.relief.hidden === true;

// The map box must never scroll (see app.css); browsers without "overflow: clip" can still
// scroll a hidden overflow, so put it straight back if they do.
for (const el of [els.mapBox, els.map]) el.addEventListener("scroll", () => el.scrollTop || el.scrollLeft ? el.scrollTo(0, 0) : undefined);

// A share link (?map=code) opens the map it names; otherwise the page starts on a new seed.
const params = new URLSearchParams(location.search);
const shared = decodeSettings(params.get("map") ?? "");
state.settings = shared?.settings ?? { ...DEFAULT_SETTINGS, seed: randomSeed() };
state.linkEdits = shared ? await decodeEdits(params.get("e") ?? "") : null;
const badLinkEdits = !!shared && !!params.get("e") && !state.linkEdits;
if (badLinkEdits) els.shareStatus.value = "The edits in this link could not be read, so the map is shown without them.";
if (shared && shared.version > GENERATOR_VERSION) {
  els.shareStatus.value = "This link was made with a different version of the generator, so the map may differ slightly.";
}

// Redraw once for a burst of changes while a slider is dragged. A message-channel hop is
// used rather than an animation frame, which browsers pause in background tabs.
let queued = false;
const tick = new MessageChannel();
let pendingDraw: () => void = () => {};
tick.port1.onmessage = () => pendingDraw();
syncForm();
draw();
void loadInk();

// Generate draws a new map. If a different seed has been typed in, that seed is drawn
// instead, so a map someone liked can be brought back.
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (Number(els.seed.value) === state.settings.seed) els.seed.value = String(randomSeed());
  readForm();
  draw();
});
// The shape redraws as it changes, sliders when let go; the seed redraws on Enter or Generate.
// Making a map takes a second or two, so dragging a slider only updates its number; the map
// is made again once the slider is let go (or moved with the keyboard).
for (const input of [els.sea, els.mountains, els.forest, els.towns, els.seaLife]) {
  input.addEventListener("input", showSliderValues);
  input.addEventListener("change", () => (readForm(), draw()));
}
function showSliderValues() {
  els.seaOut.value = `${els.sea.value}% water`;
  els.mountainsOut.value = `${els.mountains.value}%`;
  els.forestOut.value = `${els.forest.value}%`;
  els.townsOut.value = els.towns.value;
  els.seaLifeOut.value = `${els.seaLife.value}%`;
  els.wavesOut.value = `${els.waves.value}%`;
}
els.shape.addEventListener("change", () => (readForm(), draw()));
// The border and coast styles change only the drawing, so the map is redrawn, not generated
// again (and its edits and generator version stay as they are).
// So do the wave marks, compass lines, shallows and deltas.
for (const control of [els.border, els.coast, els.waves, els.compassLines, els.shallows, els.deltas])
  control.addEventListener("change", () => {
    const style = {
      border: els.border.value as Border,
      coast: els.coast.value as Coast,
      waves: Number(els.waves.value) / 100,
      compass_lines: els.compassLines.checked,
      shallows: els.shallows.checked,
      deltas: els.deltas.checked,
    };
    state.settings = cleanSettings({ ...state.settings, ...style });
    if (!state.current) return;
    state.current = { ...state.current, settings: { ...state.current.settings, ...style } };
    paint(state.current);
    void updateLink();
  });
els.waves.addEventListener("input", showSliderValues);
els.showRelief.addEventListener("change", () => state.current && paintRelief(state.current));

function readForm() {
  const [width, height] = SHAPES[els.shape.value] ?? SHAPES.portrait;
  state.settings = cleanSettings({
    ...state.settings,
    // A changed map is drawn with the newest generator; only an opened link keeps its own.
    v: GENERATOR_VERSION,
    seed: Number(els.seed.value),
    width,
    height,
    sea_level: Number(els.sea.value) / 100,
    mountain_density: Number(els.mountains.value) / 100,
    forest_density: Number(els.forest.value) / 100,
    town_count: Number(els.towns.value),
    sea_life: Number(els.seaLife.value) / 100,
  });
  syncForm();
}

function syncForm() {
  els.seed.value = String(state.settings.seed);
  els.shape.value = Object.keys(SHAPES).find((k) => SHAPES[k][0] === state.settings.width && SHAPES[k][1] === state.settings.height) ?? "portrait";
  els.border.value = state.settings.border;
  els.coast.value = state.settings.coast;
  els.sea.value = String(Math.round(state.settings.sea_level * 100));
  els.seaOut.value = `${els.sea.value}% water`;
  els.mountains.value = String(Math.round(state.settings.mountain_density * 100));
  els.mountainsOut.value = `${els.mountains.value}%`;
  els.forest.value = String(Math.round(state.settings.forest_density * 100));
  els.forestOut.value = `${els.forest.value}%`;
  els.towns.value = String(state.settings.town_count);
  els.townsOut.value = els.towns.value;
  els.seaLife.value = String(Math.round(state.settings.sea_life * 100));
  els.seaLifeOut.value = `${els.seaLife.value}%`;
  els.waves.value = String(Math.round(state.settings.waves * 100));
  els.wavesOut.value = `${els.waves.value}%`;
  els.compassLines.checked = state.settings.compass_lines;
  els.shallows.checked = state.settings.shallows;
  els.deltas.checked = state.settings.deltas;
}

function draw() {
  if (queued) return;
  queued = true;
  tick.port2.postMessage(null);
  pendingDraw = () => {
    queued = false;
    const t0 = performance.now();
    const map = generate(state.settings);
    if (!state.current || state.current.settings.width !== map.settings.width || state.current.settings.height !== map.settings.height) state.zoom.reset(map.settings.width, map.settings.height);
    // A new map starts with no edits; they belong to the map they were made on.
    state.edits = state.linkEdits ?? NO_EDITS;
    state.linkEdits = null;
    state.undoStack = [];
    state.redoStack = [];
    state.picked = [];
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
    state.confirmPublish = false;
    els.publish.textContent = "Publish to the public gallery";
    els.keepStatus.textContent = "";
  };
}

export function svgFor(map: EditedMap, fontCss?: string, onScreen = false): string {
  const { width, height } = map.settings;
  return renderSvg({ width, height, water: map.water, symbols: map.symbols, towns: map.towns, labels: map.labels, ink: state.ink, fontCss, border: map.settings.border, coast: map.settings.coast, sea: seaStyle(map.settings), sprites: onScreen && spritesWanted() ? state.sprites : undefined });
}

// The sea's drawing options. Compass lines radiate from where the compass rose was first
// placed (moving the rose later leaves them be), and from two fainter wind roses.
function seaStyle(s: MapSettings): SeaStyle {
  const { width: W, height: H } = s;
  const rose = state.current?.labels.labels.find((l) => l.kind === "compass");
  const roses: [number, number][] = [rose ? [rose.x, rose.y] : [W * 0.5, H * 0.5], [W * 0.22, H * 0.72], [W * 0.8, H * 0.35]];
  return { waves: s.waves, compassLines: s.compass_lines, shallows: s.shallows, deltas: s.deltas, roses };
}

export function paint(map: GeneratedMap) {
  state.current = map;
  state.edited = applyEdits(map, state.edits);
  state.hitList = null;
  const { width, height } = map.settings;
  els.mapBox.style.aspectRatio = `${width} / ${height}`;
  state.spritesShown = spritesWanted();
  els.map.innerHTML = svgFor(state.edited, undefined, true);
  const svg = els.map.querySelector("svg")!;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Map for seed ${map.settings.seed}: coast, rivers, lakes, mountains, hills and forests in black ink.`);
  paintRelief(map);
  applyView(state.zoom.view);
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
  placeSelBox();
  if (state.current && state.spritesShown !== spritesWanted()) paint(state.current);
}

// Mid-gesture: move the picture already drawn instead of redrawing the map.
function previewView(drawn: View, live: View) {
  const svg = els.map.querySelector("svg");
  if (!svg) return;
  const r = els.map.getBoundingClientRect();
  const t = previewTransform(drawn, live, r.width, r.height);
  svg.style.transform = `scale(${t.k}) translate3d(${t.tx}px, ${t.ty}px, 0)`;
  els.relief.style.visibility = "hidden"; // shown again, lined up, when the map is redrawn
  els.selBox.hidden = true; // likewise
  els.selBar.hidden = true;
  showZoomState();
}

function showZoomState() {
  const level = state.zoom.level;
  els.zoomLevel.value = `${Math.round(level * 100)}%`;
  els.zoomIn.disabled = level >= MAX_ZOOM - 0.001;
  els.zoomOut.disabled = els.zoomFit.disabled = level <= 1.0001;
  els.map.classList.toggle("zoomed", level > 1.0001);
}

// Line the relief up with the drawing inside the frame, at the current zoom.
function positionRelief() {
  if (els.relief.hidden || !state.current) return;
  const { width: W, height: H } = state.current.settings;
  const fr = frameFor(W, H);
  const v = state.zoom.view;
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

// The editing tools and the panels. Pointer and key handlers are registered in this order,
// which matters where two listen for the same event (both keydown handlers are in keys.ts).
initActions();
initHistory();
initGestures();
initKeys();
initClipboard();
initPanels();
initPalette();
initResize();


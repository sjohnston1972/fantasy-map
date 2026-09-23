// The public map page. Milestone 2: generate the height map and land and sea from a seed,
// and show it as a grey relief. Everything runs in the visitor's browser.

import { generate, type GeneratedMap } from "../gen/pipeline";
import { renderRelief } from "../gen/render";
import { renderSvg } from "../gen/svg";
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
};

let settings: MapSettings = { ...DEFAULT_SETTINGS };
let current: GeneratedMap | null = null;

// Redraw once for a burst of changes while a slider is dragged. A message-channel hop is
// used rather than an animation frame, which browsers pause in background tabs.
let queued = false;
const tick = new MessageChannel();
let pendingDraw: () => void = () => {};
tick.port1.onmessage = () => pendingDraw();
syncForm();
draw();

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

function paint(map: GeneratedMap) {
  current = map;
  const { width, height } = map.settings;
  els.mapBox.style.aspectRatio = `${width} / ${height}`;
  els.map.innerHTML = renderSvg({ width, height, water: map.water, symbols: map.symbols, towns: map.towns });
  const svg = els.map.querySelector("svg")!;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Map for seed ${map.settings.seed}: coast, rivers, lakes, mountains, hills and forests in black ink.`);
  paintRelief(map);
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

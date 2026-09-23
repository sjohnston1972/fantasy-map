// The public map page. Milestone 2: generate the height map and land and sea from a seed,
// and show it as a grey relief. Everything runs in the visitor's browser.

import { generate, type GeneratedMap } from "../gen/pipeline";
import { drawRivers, renderRelief } from "../gen/render";
import { randomSeed } from "../gen/rng";
import { cleanSettings, DEFAULT_SETTINGS, type MapSettings } from "../gen/settings";

const SHAPES: Record<string, [number, number]> = {
  portrait: [1600, 2400],
  landscape: [2400, 1600],
  square: [2000, 2000],
};

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const els = {
  form: $<HTMLFormElement>("#settings"),
  seed: $<HTMLInputElement>("#seed"),
  dice: $<HTMLButtonElement>("#dice"),
  shape: $<HTMLSelectElement>("#shape"),
  sea: $<HTMLInputElement>("#sea"),
  seaOut: $<HTMLOutputElement>("#sea-out"),
  mountains: $<HTMLInputElement>("#mountains"),
  mountainsOut: $<HTMLOutputElement>("#mountains-out"),
  canvas: $<HTMLCanvasElement>("#map"),
  caption: $<HTMLElement>("#caption"),
};

let settings: MapSettings = { ...DEFAULT_SETTINGS };

// Redraw once for a burst of changes while a slider is dragged. A message-channel hop is
// used rather than an animation frame, which browsers pause in background tabs.
let queued = false;
const tick = new MessageChannel();
let pendingDraw: () => void = () => {};
tick.port1.onmessage = () => pendingDraw();
syncForm();
draw();

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  readForm();
  draw();
});
els.dice.addEventListener("click", () => {
  els.seed.value = String(randomSeed());
  readForm();
  draw();
});
// Sliders and the shape redraw as they change; the seed redraws on Enter or Generate.
for (const input of [els.sea, els.mountains]) input.addEventListener("input", () => (readForm(), draw()));
els.shape.addEventListener("change", () => (readForm(), draw()));

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
    const ms = Math.round(performance.now() - t0);
    const w = map.water;
    els.caption.textContent = `Seed ${map.settings.seed}, ${map.settings.width} by ${map.settings.height} px: ${Math.round((1 - map.landSea.landShare) * 100)}% sea, ${w.rivers.length} rivers, ${w.lakes} ${w.lakes === 1 ? "lake" : "lakes"}. Generated in ${ms} ms.`;
  };
}

// The terrain is one pixel per grid cell; the canvas is drawn at twice that so the river
// lines stay crisp when the page scales it up.
const DRAW_SCALE = 2;

function paint(map: GeneratedMap) {
  const { cols, rows } = map.height;
  els.canvas.width = cols * DRAW_SCALE;
  els.canvas.height = rows * DRAW_SCALE;
  els.canvas.style.aspectRatio = `${map.settings.width} / ${map.settings.height}`;
  const relief = new OffscreenCanvas(cols, rows);
  relief.getContext("2d")!.putImageData(new ImageData(renderRelief(map.height, map.landSea, map.water), cols, rows), 0, 0);
  const ctx = els.canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(relief, 0, 0, cols * DRAW_SCALE, rows * DRAW_SCALE);
  drawRivers(ctx, map.water, DRAW_SCALE);
  els.canvas.setAttribute("aria-label", `Terrain preview for seed ${map.settings.seed}: land shaded grey by height, sea pale, rivers and lakes in blue.`);
}

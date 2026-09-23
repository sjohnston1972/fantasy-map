// Stage 7: labels (spec step 7: "Names are generated and placed so they do not overlap
// symbols or each other") and emblems.
//
// Labels are placed in order of importance: the capital, towns, villages, then the sea,
// regions, lakes and rivers. A label never overlaps another label, a settlement, a landmark
// or a bridge. Where it falls on trees, hills and other scattered symbols, those symbols are
// removed, as an engraver leaves space for the lettering. Text sizes are estimated from the
// typeface's average letter width, since the generator also runs where no fonts exist.

import { BIOME, type Climate } from "./climate";
import { WATER_LAKE, WATER_SEA, type Hydrology } from "./hydrology";
import { cultureAt, Namer, type Culture } from "./names";
import { rng, stageSeed } from "./rng";
import type { MapSettings } from "./settings";
import type { Settlements } from "./settlements";
import type { PlacedSymbol } from "./symbols";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LabelKind = "capital" | "town" | "village" | "sea" | "region" | "lake" | "river";

export interface Label {
  id: number;
  kind: LabelKind;
  text: string;
  x: number; // text position (see anchor), map pixels; y is the baseline
  y: number;
  anchor: "start" | "middle" | "end";
  size: number; // font size, map pixels
  italic: boolean;
  caps: boolean;
  spacing: number; // extra space between letters, in ems
  box: Box; // the area the lettering covers
  path?: [number, number][]; // river labels follow the river
  ref?: number; // settlement id, for town labels
  culture: Culture;
}

export interface Emblem {
  x: number; // bottom centre
  y: number;
  w: number;
  variant: number;
  town: number;
}

export interface Labelling {
  labels: Label[];
  emblems: Emblem[];
  symbols: PlacedSymbol[]; // the symbols left once lettering has been cleared
  removed: number; // symbols cleared to make room
}

// Average letter width as a share of font size for the map typeface (IM Fell English), in
// lower case and in capitals.
const LOWER = 0.47;
const UPPER = 0.66;

export function textWidth(text: string, size: number, caps: boolean, spacing: number): number {
  return text.length * size * (caps ? UPPER : LOWER) + Math.max(0, text.length - 1) * spacing * size;
}

export function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

export function placeLabels(hy: Hydrology, cl: Climate, towns: Settlements, symbols: PlacedSymbol[], s: MapSettings): Labelling {
  const { cols, rows } = hy;
  const W = s.width;
  const H = s.height;
  const cellW = W / cols;
  const cellH = H / rows;
  const px = Math.min(W, H) / 1600;
  const next = rng(stageSeed(s.seed, "labels"));
  const namer = new Namer(rng(stageSeed(s.seed, "names")));
  const twist = next();
  const cultureOf = (x: number, y: number) => {
    const c = Math.min(cols - 1, Math.floor(x / cellW));
    const r = Math.min(rows - 1, Math.floor(y / cellH));
    return cultureAt(y / H, x / W, cl.temperature[r * cols + c], twist);
  };
  const inset = 24 * px; // stay inside the border
  const inside = (b: Box) => b.x > inset && b.y > inset && b.x + b.w < W - inset && b.y + b.h < H - inset;

  // Things lettering must never cover: settlement and landmark drawings, bridges.
  const hard: Box[] = [];
  const townSize = { capital: 74, town: 56, village: 40 };
  for (const p of towns.places) {
    const tw = townSize[p.tier] * px;
    hard.push({ x: p.x - tw / 2, y: p.y - tw * 0.85, w: tw, h: tw });
  }
  for (const l of towns.landmarks) hard.push({ x: l.x - 16 * px, y: l.y - 30 * px, w: 32 * px, h: 30 * px });
  for (const b of towns.bridges) hard.push({ x: b.x - 12 * px, y: b.y - 10 * px, w: 24 * px, h: 20 * px });

  const labels: Label[] = [];
  const emblems: Emblem[] = [];
  const free = (b: Box) => inside(b) && !hard.some((h) => boxesOverlap(b, h, 2 * px)) && !labels.some((l) => boxesOverlap(b, l.box, 4 * px)) && !emblems.some((e) => boxesOverlap(b, emblemBox(e), 3 * px));
  const add = (l: Omit<Label, "id">) => {
    const label = { ...l, id: labels.length };
    labels.push(label);
    return label;
  };
  // How many symbols a box would clear: fewer is better.
  const clutter = (b: Box) => symbols.reduce((n, sym) => n + (boxesOverlap(b, symBox(sym)) ? 1 : 0), 0);

  // 1. Settlements, most important first; try positions around each drawing.
  const tierOrder = { capital: 0, town: 1, village: 2 };
  for (const p of [...towns.places].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || a.id - b.id)) {
    const culture = cultureOf(p.x, p.y);
    const text = namer.place(culture, p.coastal || p.onRiver);
    const size = (p.tier === "capital" ? 26 : p.tier === "town" ? 20 : 15) * px;
    const caps = p.tier === "capital";
    const spacing = caps ? 0.08 : 0;
    const w = textWidth(text, size, caps, spacing);
    const tw = townSize[p.tier] * px;
    const gap = 4 * px;
    const mid = p.y - tw * 0.3 + size * 0.35;
    const options: { x: number; y: number; anchor: Label["anchor"] }[] = [
      { x: p.x + tw / 2 + gap, y: mid, anchor: "start" },
      { x: p.x - tw / 2 - gap, y: mid, anchor: "end" },
      { x: p.x, y: p.y + tw * 0.2 + size, anchor: "middle" },
      { x: p.x, y: p.y - tw * 0.85 - gap, anchor: "middle" },
      { x: p.x + tw / 2 + gap, y: mid - size, anchor: "start" },
      { x: p.x + tw / 2 + gap, y: mid + size, anchor: "start" },
      { x: p.x - tw / 2 - gap, y: mid - size, anchor: "end" },
      { x: p.x - tw / 2 - gap, y: mid + size, anchor: "end" },
      { x: p.x, y: p.y + tw * 0.2 + size * 2, anchor: "middle" },
      { x: p.x, y: p.y - tw * 0.85 - gap - size, anchor: "middle" },
    ];
    // Crowded spots: widen the search in rings around the settlement, then try smaller type.
    for (const ring of [1.6, 2.4, 3.4]) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const dx = Math.cos(ang) * tw * ring * 0.6;
        const dy = Math.sin(ang) * tw * ring * 0.45;
        options.push({ x: p.x + dx, y: mid + dy, anchor: dx > tw * 0.2 ? "start" : dx < -tw * 0.2 ? "end" : "middle" });
      }
    }
    let placed = false;
    for (const shrink of [1, 0.85, 0.72]) {
      const sz = size * shrink;
      const ww = w * shrink;
      let best: { x: number; y: number; anchor: Label["anchor"]; box: Box; cost: number } | null = null;
      options.forEach((o, k) => {
        const box = boxFor(o.x, o.y, o.anchor, ww, sz);
        if (!free(box)) return;
        const cost = clutter(box) + k * 0.5; // prefer the usual right-hand position
        if (!best || cost < best.cost) best = { ...o, box, cost };
      });
      if (!best) continue;
      const b = best as { x: number; y: number; anchor: Label["anchor"]; box: Box };
      add({ kind: p.tier, text, x: b.x, y: b.y, anchor: b.anchor, size: sz, italic: p.tier === "village", caps, spacing, box: b.box, ref: p.id, culture });
      placed = true;
      break;
    }
    if (!placed) continue;
  }

  // 2. Emblems: a banner beside the capital and the next two largest towns.
  const emblemTowns = labels.filter((l) => l.kind === "capital" || l.kind === "town").slice(0, 3);
  for (const l of emblemTowns) {
    const ew = (l.kind === "capital" ? 34 : 26) * px;
    const variant = next();
    const g = 4 * px;
    // Beside the name first, then above or below it.
    const spots: [number, number][] = [
      [l.anchor === "end" ? l.box.x - ew / 2 - g : l.box.x + l.box.w + ew / 2 + g, l.box.y + l.box.h + ew * 0.35],
      [l.anchor === "end" ? l.box.x + l.box.w + ew / 2 + g : l.box.x - ew / 2 - g, l.box.y + l.box.h + ew * 0.35],
      [l.box.x + l.box.w / 2, l.box.y - g],
      [l.box.x + l.box.w / 2, l.box.y + l.box.h + ew * 1.3 + g],
      [l.box.x - ew / 2 - g, l.box.y - g],
      [l.box.x + l.box.w + ew / 2 + g, l.box.y - g],
    ];
    for (const [x, y] of spots) {
      const e: Emblem = { x, y, w: ew, variant, town: l.ref ?? 0 };
      const eb = emblemBox(e);
      if (inside(eb) && !hard.some((h) => boxesOverlap(eb, h)) && !labels.some((o) => boxesOverlap(eb, o.box, 2 * px)) && !emblems.some((o) => boxesOverlap(eb, emblemBox(o), 2 * px))) {
        emblems.push(e);
        break;
      }
    }
  }

  // Distance maps for finding roomy spots inside areas.
  const seaDist = distanceInside(hy, (i) => hy.water[i] === WATER_SEA);

  // 3. The sea: at the open water furthest from any coast.
  {
    let bestI = -1;
    for (let i = 0; i < seaDist.length; i++) if (hy.water[i] === WATER_SEA && (bestI < 0 || seaDist[i] > seaDist[bestI])) bestI = i;
    if (bestI >= 0 && seaDist[bestI] > 6) {
      const x = ((bestI % cols) + 0.5) * cellW;
      const y = (Math.floor(bestI / cols) + 0.5) * cellH;
      const culture = cultureOf(x, y);
      placeArea("sea", namer.sea(culture), x, y, 30 * px, true, 0.3, true, culture);
    }
  }

  // 4. Regions: large forests, mountain ranges, marshes, deserts and wilds.
  const kinds: [number, "forest" | "mountain" | "marsh" | "desert" | "tundra", number][] = [
    [BIOME.mountain, "mountain", 350],
    [BIOME.forest, "forest", 900],
    [BIOME.desert, "desert", 500],
    [BIOME.tundra, "tundra", 900],
    [BIOME.marsh, "marsh", 300],
  ];
  const regions: { kind: "forest" | "mountain" | "marsh" | "desert" | "tundra"; cell: number; size: number }[] = [];
  for (const [biome, kind, minCells] of kinds) {
    for (const reg of components(cl.biome, cols, rows, biome)) {
      if (reg.cells.length < minCells) continue;
      const dist = distanceInside(hy, (i) => cl.biome[i] === biome, reg.cells);
      let bestI = reg.cells[0];
      for (const i of reg.cells) if (dist[i] > dist[bestI]) bestI = i;
      regions.push({ kind, cell: bestI, size: reg.cells.length });
    }
  }
  regions.sort((a, b) => b.size - a.size);
  for (const r of regions.slice(0, 7)) {
    const x = ((r.cell % cols) + 0.5) * cellW;
    const y = (Math.floor(r.cell / cols) + 0.5) * cellH;
    const culture = cultureOf(x, y);
    placeArea("region", namer.region(culture, r.kind), x, y, (r.kind === "mountain" ? 19 : 21) * px, true, 0.22, false, culture);
  }

  // 5. Lakes: at the middle of the water, or beside the lake if it is too small.
  const lakeDist = distanceInside(hy, (i) => hy.water[i] === WATER_LAKE);
  const lakeBest = new Map<number, number>();
  for (let i = 0; i < hy.lakeId.length; i++) {
    const id = hy.lakeId[i];
    if (id < 0) continue;
    const cur = lakeBest.get(id);
    if (cur === undefined || lakeDist[i] > lakeDist[cur]) lakeBest.set(id, i);
  }
  for (const i of lakeBest.values()) {
    if (lakeDist[i] < 3) continue; // too small to letter
    const x = ((i % cols) + 0.5) * cellW;
    const y = (Math.floor(i / cols) + 0.5) * cellH;
    const culture = cultureOf(x, y);
    placeArea("lake", namer.lake(culture), x, y, 15 * px, false, 0.04, true, culture);
  }

  // 6. Rivers: the biggest few, lettered along a gentle stretch of their course.
  const bigRivers = hy.rivers.filter((r) => r.cells.length > 30).sort((a, b) => b.flow[b.flow.length - 1] - a.flow[a.flow.length - 1]).slice(0, 6);
  for (const r of bigRivers) {
    const pts = r.cells.filter((c) => hy.water[c] === 0).map((c) => [((c % cols) + 0.5) * cellW, (Math.floor(c / cols) + 0.5) * cellH] as [number, number]);
    const culture = cultureOf(pts[Math.floor(pts.length / 2)][0], pts[Math.floor(pts.length / 2)][1]);
    const text = namer.river(culture);
    const size = 14 * px;
    const need = textWidth(text, size, false, 0.02) * 1.1;
    // Try stretches from the middle outwards; the text runs left to right along the river.
    for (let start = Math.floor(pts.length * 0.35); start < pts.length; start += 6) {
      const run: [number, number][] = [];
      let len = 0;
      for (let k = start; k < pts.length - 1 && len < need; k++) {
        run.push(pts[k]);
        len += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
      }
      if (len < need) break;
      const path = smoothPath(run[0][0] <= run[run.length - 1][0] ? run : [...run].reverse());
      // Skip steep stretches: lettering reads badly going nearly straight up or down.
      const dx = path[path.length - 1][0] - path[0][0];
      const dy = path[path.length - 1][1] - path[0][1];
      if (Math.abs(dy) > Math.abs(dx) * 1.2) continue;
      const xs = path.map((p) => p[0]);
      const ys = path.map((p) => p[1]);
      const box = { x: Math.min(...xs) - 2, y: Math.min(...ys) - size, w: Math.max(...xs) - Math.min(...xs) + 4, h: Math.max(...ys) - Math.min(...ys) + size * 1.3 };
      if (!free(box)) continue;
      add({ kind: "river", text, x: path[0][0], y: path[0][1], anchor: "start", size, italic: true, caps: false, spacing: 0.02, box, path, culture });
      break;
    }
  }

  // 7. Clear symbols from under the lettering and emblems.
  const clear = [...labels.map((l) => l.box), ...emblems.map(emblemBox)];
  const kept = symbols.filter((sym) => !clear.some((b) => boxesOverlap(symBox(sym), b, 1)));
  return { labels, emblems, symbols: kept, removed: symbols.length - kept.length };

  // Area labels (sea, regions, lakes): centred on a point, nudged about if the spot is taken.
  function placeArea(kind: LabelKind, text: string, x: number, y: number, size: number, caps: boolean, spacing: number, italic: boolean, culture: Culture) {
    const w = textWidth(text, size, caps, spacing);
    for (const [dx, dy] of [[0, 0], [0, -1.5], [0, 1.5], [-1, 0], [1, 0], [0, -3], [0, 3]]) {
      const lx = x + dx * w * 0.3;
      const ly = y + dy * size;
      const box = boxFor(lx, ly, "middle", w, size);
      if (!free(box)) continue;
      add({ kind, text, x: lx, y: ly, anchor: "middle", size, italic, caps, spacing, box, culture });
      return;
    }
  }
}

function boxFor(x: number, y: number, anchor: Label["anchor"], w: number, size: number): Box {
  const left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { x: left, y: y - size * 0.8, w, h: size * 1.05 };
}

export function symBox(s: PlacedSymbol): Box {
  return { x: s.x - s.w / 2, y: s.y - s.h, w: s.w, h: s.h };
}

export function emblemBox(e: Emblem): Box {
  return { x: e.x - e.w / 2, y: e.y - e.w * 1.25, w: e.w, h: e.w * 1.25 };
}

// Distance (in cells) from each cell inside an area to the area's edge.
function distanceInside(hy: Hydrology, inArea: (i: number) => boolean, only?: number[]): Float32Array {
  const { cols, rows } = hy;
  const n = cols * rows;
  const dist = new Float32Array(n);
  const queue: number[] = [];
  const cells = only ?? Array.from({ length: n }, (_, i) => i);
  const member = new Uint8Array(n);
  for (const i of cells) if (inArea(i)) member[i] = 1;
  for (const i of cells) {
    if (!member[i]) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    const edge = c === 0 || r === 0 || c === cols - 1 || r === rows - 1 || !member[i - 1] || !member[i + 1] || !member[i - cols] || !member[i + cols];
    dist[i] = edge ? 1 : Infinity;
    if (edge) queue.push(i);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const c = i % cols;
    const r = (i - c) / cols;
    for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1]) {
      if (j >= 0 && member[j] && dist[j] > dist[i] + 1) {
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

function components(biome: Uint8Array, cols: number, rows: number, target: number): { cells: number[] }[] {
  const seen = new Uint8Array(biome.length);
  const out: { cells: number[] }[] = [];
  for (let s = 0; s < biome.length; s++) {
    if (seen[s] || biome[s] !== target) continue;
    const cells: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const c = i % cols;
      const r = (i - c) / cols;
      for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1]) {
        if (j >= 0 && !seen[j] && biome[j] === target) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push({ cells });
  }
  return out;
}

// Two passes of corner cutting, so river lettering follows a gentle curve.
function smoothPath(pts: [number, number][]): [number, number][] {
  let p = pts;
  for (let k = 0; k < 2; k++) {
    if (p.length < 3) break;
    const out: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      out.push([0.75 * p[i][0] + 0.25 * p[i + 1][0], 0.75 * p[i][1] + 0.25 * p[i + 1][1]], [0.25 * p[i][0] + 0.75 * p[i + 1][0], 0.25 * p[i][1] + 0.75 * p[i + 1][1]]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

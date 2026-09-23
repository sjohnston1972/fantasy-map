// Stage 5: towns and roads (spec step 5). "Towns are placed on good sites, such as river
// crossings and flat ground near water. Roads connect them along the easiest path,
// avoiding steep ground." Every road that crosses a river gets a bridge (spec acceptance),
// and farmland is laid around each settlement.
//
// Settlements go on the largest landmass only: roads cannot reach islands, and the spec
// requires roads to connect every town.

import { BIOME, type Climate } from "./climate";
import { WATER_SEA, type Hydrology } from "./hydrology";
import { rng, stageSeed } from "./rng";
import type { MapSettings } from "./settings";

export type Tier = "capital" | "town" | "village";

export interface Settlement {
  id: number;
  tier: Tier;
  cell: number;
  x: number; // map pixels
  y: number;
  coastal: boolean;
  onRiver: boolean;
}

export interface Road {
  cells: number[]; // grid cells from one end to the other
  from: number; // settlement ids
  to: number;
}

export interface Bridge {
  cell: number; // the river cell the road crosses
  x: number;
  y: number;
  angle: number; // direction of the road across the river, radians
}

export interface Landmark {
  id: number;
  cell: number;
  x: number;
  y: number;
}

export interface Settlements {
  places: Settlement[];
  landmarks: Landmark[]; // ruins, forts, temples: points of interest away from towns
  roads: Road[];
  bridges: Bridge[];
  roadCells: Uint8Array; // 1 where a road runs
  farmland: Uint8Array; // 1 where fields were laid
}

const DC = [1, -1, 0, 0, 1, -1, 1, -1];
const DR = [0, 0, 1, -1, 1, 1, -1, -1];

export function settle(hy: Hydrology, cl: Climate, s: MapSettings): Settlements {
  const { cols, rows, water } = hy;
  const n = cols * rows;
  const cellW = s.width / cols;
  const cellH = s.height / rows;
  const scale = Math.min(s.width, s.height) / 1600;
  const next = rng(stageSeed(s.seed, "settlements"));

  const mainland = largestLandmass(hy);
  const riverFlow = new Float32Array(n);
  for (const r of hy.rivers) r.cells.forEach((c, k) => water[c] === 0 && (riverFlow[c] = Math.max(riverFlow[c], r.flow[k])));
  let maxFlow = 1;
  for (const v of riverFlow) if (v > maxFlow) maxFlow = v;

  // 1. Score every cell as a place to live.
  const score = new Float32Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    if (!mainland[i] || riverFlow[i] > 0) continue; // build beside rivers, not in them
    const b = cl.biome[i];
    if (b === BIOME.mountain || b === BIOME.marsh) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    let slope = 0;
    let nearSea = false;
    let nearLake = false;
    let nearRiver = 0;
    for (let k = 0; k < 8; k++) {
      const nc = c + DC[k];
      const nr = r + DR[k];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (water[j] === WATER_SEA) nearSea = true;
      else if (water[j]) nearLake = true;
      else slope = Math.max(slope, Math.abs(hy.heights[j] - hy.heights[i]));
      nearRiver = Math.max(nearRiver, riverFlow[j]);
    }
    let v = 1 - slope * 60 - cl.elevation[i] * 1.2; // flat, low ground
    if (nearRiver) v += 0.8 + 0.8 * Math.sqrt(nearRiver / maxFlow); // bigger rivers, better sites
    if (nearSea) v += 0.9; // harbours
    if (nearLake) v += 0.5;
    if (nearSea && nearRiver) v += 0.8; // river mouths are the best sites of all
    if (b === BIOME.grassland) v += 0.3;
    if (b === BIOME.desert || b === BIOME.tundra) v -= 0.7;
    // Keep clear of the frame.
    if (c < 6 || r < 6 || c >= cols - 6 || r >= rows - 6) v -= 5;
    score[i] = v + next() * 0.15; // a little randomness so equal sites do not tie
  }

  // 2. Pick sites, best first, keeping settlements apart.
  const order = Array.from(score.keys()).filter((i) => score[i] > -Infinity).sort((a, b) => score[b] - score[a] || a - b);
  const places: Settlement[] = [];
  const townCount = Math.max(1, s.town_count);
  // The town count setting is the number of towns including the capital; villages add
  // about two per town.
  const wanted: [Tier, number][] = [
    ["capital", 1],
    ["town", townCount - 1],
    ["village", townCount * 2],
  ];
  const minGap = (tier: Tier) => (tier === "village" ? 70 : 150) * scale;
  for (const [tier, count] of wanted) {
    let added = 0;
    for (const i of order) {
      if (added >= count) break;
      const x = ((i % cols) + 0.5) * cellW;
      const y = (Math.floor(i / cols) + 0.5) * cellH;
      if (places.some((p) => Math.hypot(p.x - x, p.y - y) < Math.max(minGap(tier), minGap(p.tier) * 0.7))) continue;
      places.push({ id: places.length, tier, cell: i, x, y, coastal: hasNeighbour(i, cols, rows, (j) => water[j] === WATER_SEA), onRiver: hasNeighbour(i, cols, rows, (j) => riverFlow[j] > 0) });
      added++;
    }
  }

  // 3. Roads: join each settlement to the growing network by the cheapest route.
  const roadCells = new Uint8Array(n);
  const roads: Road[] = [];
  const connected = [places[0]];
  const pending = places.slice(1);
  while (pending.length) {
    // Next: the settlement closest to anything already connected.
    let best = 0;
    let bestTo = connected[0];
    let bestD = Infinity;
    pending.forEach((p, k) => {
      for (const q of connected) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < bestD) (bestD = d), (best = k), (bestTo = q);
      }
    });
    const p = pending.splice(best, 1)[0];
    const path = roadPath(hy, cl, roadCells, riverFlow, p.cell, bestTo.cell);
    if (path) {
      for (const c of path) roadCells[c] = 1;
      roads.push({ cells: path, from: p.id, to: bestTo.id });
    }
    connected.push(p);
  }

  // 4. Bridges: one wherever a road steps onto a river.
  const bridges: Bridge[] = [];
  const bridged = new Set<number>();
  for (const road of roads) {
    road.cells.forEach((c, k) => {
      if (!(riverFlow[c] > 0) || bridged.has(c)) return;
      // Skip if the previous step was already on this river (one bridge per crossing).
      if (k > 0 && riverFlow[road.cells[k - 1]] > 0) return;
      const a = road.cells[Math.max(0, k - 1)];
      const b = road.cells[Math.min(road.cells.length - 1, k + 1)];
      const angle = Math.atan2(Math.floor(b / cols) - Math.floor(a / cols), (b % cols) - (a % cols));
      bridged.add(c);
      bridges.push({ cell: c, x: ((c % cols) + 0.5) * cellW, y: (Math.floor(c / cols) + 0.5) * cellH, angle });
    });
  }

  // 5. Farmland around each settlement, on open, gentle ground.
  const farmland = new Uint8Array(n);
  const radius = { capital: 95, town: 65, village: 38 }; // map pixels at the default size
  for (const p of places) {
    const rad = (radius[p.tier] * scale) / Math.min(cellW, cellH); // in grid cells
    const pc = p.cell % cols;
    const pr = Math.floor(p.cell / cols);
    for (let dr = -Math.ceil(rad); dr <= rad; dr++) {
      for (let dc = -Math.ceil(rad); dc <= rad; dc++) {
        const c = pc + dc;
        const r = pr + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const i = r * cols + c;
        const d = Math.hypot(dc, dr) / rad;
        if (d > 1 || water[i] || riverFlow[i] > 0) continue;
        const b = cl.biome[i];
        if (b !== BIOME.grassland && b !== BIOME.forest) continue;
        // Ragged edges: fields thin out away from the settlement.
        if (next() > 1.15 - d) continue;
        farmland[i] = 1;
        cl.biome[i] = BIOME.farmland;
      }
    }
  }
  // 6. Landmarks: a few ruins, forts or temples out in the country, away from towns and
  //    roads, preferring rising ground.
  const landmarks: Landmark[] = [];
  const wantLandmarks = Math.min(8, 3 + Math.floor(townCount / 2));
  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    if (water[i] || riverFlow[i] > 0 || roadCells[i] || farmland[i]) continue;
    const b = cl.biome[i];
    if (b === BIOME.marsh || b === BIOME.mountain) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    if (c < 10 || r < 10 || c >= cols - 10 || r >= rows - 10) continue;
    if (cl.elevation[i] > 0.15 || next() < 0.02) candidates.push(i);
  }
  for (let tries = 0; tries < 4000 && landmarks.length < wantLandmarks && candidates.length; tries++) {
    const i = candidates[Math.floor(next() * candidates.length)];
    const x = ((i % cols) + 0.5) * cellW;
    const y = (Math.floor(i / cols) + 0.5) * cellH;
    const clear = (px: number, py: number, d: number) => Math.hypot(px - x, py - y) > d * scale;
    if (!places.every((p) => clear(p.x, p.y, 120)) || !landmarks.every((l) => clear(l.x, l.y, 160))) continue;
    landmarks.push({ id: landmarks.length, cell: i, x, y });
  }
  return { places, landmarks, roads, bridges, roadCells, farmland };
}

// A* over the grid. Steep, wet, wooded or high ground costs more; running along an
// existing road costs less, so roads share their way where they can. Sea and lakes cannot
// be crossed; rivers can, at a price, and get a bridge.
function roadPath(hy: Hydrology, cl: Climate, roadCells: Uint8Array, riverFlow: Float32Array, from: number, to: number): number[] | null {
  const { cols, rows, water, heights } = hy;
  const n = cols * rows;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap();
  const tc = to % cols;
  const tr = Math.floor(to / cols);
  const h = (i: number) => Math.hypot((i % cols) - tc, Math.floor(i / cols) - tr) * 0.35;
  g[from] = 0;
  heap.push(from, h(from));
  const biomeCost = [9, 1, 1.6, 4, 6, 1.4, 1.8, 1] as const; // indexed by BIOME
  while (heap.size) {
    const i = heap.pop();
    if (i === to) break;
    const c = i % cols;
    const r = (i - c) / cols;
    for (let k = 0; k < 8; k++) {
      const nc = c + DC[k];
      const nr = r + DR[k];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (water[j]) continue;
      // A diagonal step must not slip between two river cells: that would cross the river
      // without touching it, and so without a bridge.
      if (k >= 4 && riverFlow[r * cols + nc] > 0 && riverFlow[nr * cols + c] > 0) continue;
      const step = k < 4 ? 1 : Math.SQRT2;
      const slope = Math.abs(heights[j] - heights[i]) * 400;
      let cost = step * (biomeCost[cl.biome[j]] + slope * slope);
      if (riverFlow[j] > 0) cost += riverFlow[i] > 0 ? 6 : 12; // cross rivers where needed, never follow them
      if (roadCells[j]) cost *= 0.35;
      const ng = g[i] + cost;
      if (ng < g[j]) {
        g[j] = ng;
        prev[j] = i;
        heap.push(j, ng + h(j));
      }
    }
  }
  if (prev[to] < 0 && from !== to) return null;
  const path: number[] = [];
  for (let i = to; i !== -1; i = prev[i]) {
    path.push(i);
    if (i === from) break;
  }
  return path.reverse();
}

function largestLandmass(hy: Hydrology): Uint8Array {
  const { cols, rows, water } = hy;
  const n = cols * rows;
  const label = new Int32Array(n).fill(-1);
  let best = -1;
  let bestSize = 0;
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (water[s] || label[s] >= 0) continue;
    let size = 0;
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const c = i % cols;
      const r = (i - c) / cols;
      for (let k = 0; k < 4; k++) {
        const nc = c + DC[k];
        const nr = r + DR[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (water[j] || label[j] >= 0) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    if (size > bestSize) (bestSize = size), (best = id);
    id++;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (label[i] === best) out[i] = 1;
  return out;
}

function hasNeighbour(i: number, cols: number, rows: number, test: (j: number) => boolean): boolean {
  const c = i % cols;
  const r = (i - c) / cols;
  for (let k = 0; k < 8; k++) {
    const nc = c + DC[k];
    const nr = r + DR[k];
    if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && test(nr * cols + nc)) return true;
  }
  return false;
}

class Heap {
  private idx: number[] = [];
  private key: number[] = [];
  get size() {
    return this.idx.length;
  }
  push(i: number, k: number) {
    this.idx.push(i);
    this.key.push(k);
    let p = this.idx.length - 1;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (this.key[q] <= this.key[p]) break;
      [this.idx[p], this.idx[q]] = [this.idx[q], this.idx[p]];
      [this.key[p], this.key[q]] = [this.key[q], this.key[p]];
      p = q;
    }
  }
  pop(): number {
    const top = this.idx[0];
    const li = this.idx.pop()!;
    const lk = this.key.pop()!;
    if (this.idx.length) {
      this.idx[0] = li;
      this.key[0] = lk;
      let p = 0;
      for (;;) {
        let c = 2 * p + 1;
        if (c >= this.idx.length) break;
        if (c + 1 < this.idx.length && this.key[c + 1] < this.key[c]) c++;
        if (this.key[p] <= this.key[c]) break;
        [this.idx[p], this.idx[c]] = [this.idx[c], this.idx[p]];
        [this.key[p], this.key[c]] = [this.key[c], this.key[p]];
        p = c;
      }
    }
    return top;
  }
}

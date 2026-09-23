// Stage 4: rivers and lakes (spec "How the generator works", step 4). "Rivers start high
// and always flow downhill to the sea. Water that cannot escape pools into a lake."
//
// How it works, in routing terms: the sea is the exit. A flood fill spreads inland from
// the coast, always taking the lowest unvisited ground next (priority-flood), so every
// land cell learns which neighbour leads it towards the sea by the lowest route, like a
// routing table built outwards from the exits. Hollows the flood has to climb out of
// become one of three things: a lake (a few of the biggest), a gorge carved out through
// the rim (other deep ones), or ground filled in slightly (shallow dips). Either way water
// always has a way down. Rain then flows along those routes; where enough collects, a
// river is drawn.

import type { HeightMap } from "./heightmap";
import type { LandSea } from "./landsea";

export const WATER_SEA = 1;
export const WATER_LAKE = 2;

export interface River {
  cells: number[]; // cell indexes from source to mouth
  flow: number[]; // water carried at each cell (in cells of rain)
  end: "sea" | "lake" | "river"; // what it flows into
}

export interface Hydrology {
  cols: number;
  rows: number;
  // Terrain adjusted so water always runs downhill: gorges carved, dips filled, lakes level.
  heights: Float64Array;
  water: Uint8Array; // 0 land, WATER_SEA, WATER_LAKE
  lakeId: Int32Array; // which lake a cell belongs to, or -1
  lakes: number; // how many lakes
  flowTo: Int32Array; // the neighbour each cell drains into; -1 for sea cells
  flow: Float32Array; // rain gathered by each cell, including everything upstream
  rivers: River[];
}

export interface HydrologyOptions {
  minLakeDepth: number; // a hollow must be at least this deep (height units) to hold a lake
  minLakeCells: number; // and cover at least this many cells
  maxLakeShare: number; // and no more than this share of the land
  lakesPer100k: number; // at most this many lakes per 100,000 land cells (the biggest win)
  fillDepth: number; // hollows shallower than this AND smaller than fillCells are filled in;
  fillCells: number; // anything bigger gets a gorge (filling a big hollow makes a flat plain)
  riverShare: number; // a cell is river when its flow exceeds this share of all land
}

export const DEFAULT_HYDROLOGY: HydrologyOptions = {
  minLakeDepth: 0.01,
  minLakeCells: 30,
  maxLakeShare: 0.02,
  lakesPer100k: 5,
  fillDepth: 0.004,
  fillCells: 12,
  riverShare: 0.0025,
};

// Step between neighbours in a filled hollow, so even flat ground slopes gently towards
// its outlet. Tiny compared with real height differences (heights run 0 to 1).
const EPS = 1e-7;

// 8 neighbours: right, left, down, up, then diagonals.
const DC = [1, -1, 0, 0, 1, -1, 1, -1];
const DR = [0, 0, 1, -1, 1, 1, -1, -1];

export function hydrology(m: HeightMap, ls: LandSea, o: HydrologyOptions = DEFAULT_HYDROLOGY): Hydrology {
  const { cols, rows } = m;
  const n = cols * rows;
  const water = findSea(ls, cols, rows);
  let landCells = 0;
  for (let i = 0; i < n; i++) if (water[i] !== WATER_SEA) landCells++;

  // 1. First flood over the natural terrain, to find every hollow.
  // Inland water: below sea level but cut off from the sea.
  const inlandWater = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!ls.land[i] && water[i] !== WATER_SEA) inlandWater[i] = 1;
  const first = flood(Float64Array.from(m.heights), water, cols, rows);
  const hollows = findHollows(first.raised, m.heights, water, inlandWater, cols, rows);

  // 2. Decide what each hollow becomes. A capped number hold lakes (inland water first,
  //    then the biggest hollows of a sensible size); other deep hollows get a channel carved
  //    out through their rim, the way a river cuts a gorge; shallow ones are simply filled
  //    in by the second flood.
  const maxLakes = Math.max(1, Math.round((landCells / 100000) * o.lakesPer100k));
  const lakeCells = new Uint8Array(n); // cells of the hollows chosen to hold lakes
  // Inland water (already visible as water on the land and sea map) comes first, then the
  // biggest hollows of a sensible size, up to the cap.
  const candidates = hollows
    .filter((hw) => hw.inland || (hw.depth >= o.minLakeDepth && hw.cells.length >= o.minLakeCells && hw.cells.length <= o.maxLakeShare * landCells))
    .sort((a, b) => Number(b.inland) - Number(a.inland) || b.cells.length - a.cells.length || a.pit - b.pit);
  const chosen = new Set<Hollow>(candidates.slice(0, maxLakes));
  for (const hw of chosen) for (const i of hw.cells) lakeCells[i] = 1;

  const carved = Float64Array.from(m.heights);
  const inHollow = new Int32Array(n).fill(-1);
  hollows.forEach((hw, k) => hw.cells.forEach((i) => (inHollow[i] = k)));
  hollows.forEach((hw, k) => {
    if (chosen.has(hw) || (hw.depth < o.fillDepth && hw.cells.length < o.fillCells)) return;
    // A gorge from the bottom of the hollow out through its rim, following the valley floor
    // (the lowest natural ground), then on along the drainage route, lowering any ground
    // in the way so the whole route runs downhill. It stops at the sea or at a lake, which
    // drains through its own outlet.
    // When the water spills into another hollow, the gorge carries on through that one
    // along its own valley floor, and so on, until it reaches the sea or a lake.
    let cur = carved[hw.pit];
    let at = hw.pit;
    const lower = (i: number) => {
      if (carved[i] >= cur) carved[i] = cur - EPS;
      cur = carved[i];
    };
    for (let guard = 0; guard < n; guard++) {
      const kk = inHollow[at];
      let next: number[];
      if (kk >= 0 && !lakeCells[at]) {
        next = valleyRoute(hollows[kk], kk, at, inHollow, m.heights, first.flowTo, cols, rows);
        if (!next.length) next = [first.flowTo[at]];
      } else {
        next = [first.flowTo[at]];
      }
      let stop = false;
      for (const i of next) {
        if (i < 0 || water[i] === WATER_SEA || lakeCells[i]) {
          stop = true;
          break;
        }
        lower(i);
        at = i;
      }
      if (stop) break;
    }
  });

  // 3. Second flood over the carved terrain gives the final drainage. What it still has to
  //    fill is either a chosen lake or a shallow dip.
  const { h, flowTo, order, raised } = flood(carved, water, cols, rows);
  const lakeId = new Int32Array(n).fill(-1);
  let lakes = 0;
  for (const hw of findHollows(raised, carved, water, inlandWater, cols, rows)) {
    // Only the chosen hollows hold lakes. Inland water in a basin that was given a gorge has
    // drained away and is now dry ground.
    if (!hw.cells.some((i) => lakeCells[i])) continue;
    for (const i of hw.cells) {
      water[i] = WATER_LAKE;
      lakeId[i] = lakes;
    }
    lakes++;
  }

  // 4. Rain: one unit per land or lake cell, passed downhill. Cells are handled from the
  //    far end of each route back towards the sea, so every cell has collected all its
  //    upstream water before handing it on.
  const flow = new Float32Array(n);
  for (let i = 0; i < n; i++) if (water[i] !== WATER_SEA) flow[i] = 1;
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const to = flowTo[i];
    if (to >= 0) flow[to] += flow[i];
  }

  // 5. Rivers: land cells carrying more than a set share of all the rain on the map.
  const threshold = Math.max(8, landCells * o.riverShare);
  const rivers = traceRivers(cols, rows, water, flowTo, flow, threshold);

  return { cols, rows, heights: h, water, lakeId, lakes, flowTo, flow, rivers };
}

// Priority-flood from the sea: always extend from the lowest cell reached so far. Each
// cell records the neighbour it was reached from (its way to the sea); a cell lower than
// that neighbour sits in a hollow and is raised to just above it.
export function flood(h: Float64Array, water: Uint8Array, cols: number, rows: number) {
  const n = cols * rows;
  const flowTo = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const raised = new Float64Array(n);
  const heap = new MinHeap(n);
  for (let i = 0; i < n; i++) {
    if (water[i] === WATER_SEA) {
      done[i] = 1;
      heap.push(i, h[i]);
    }
  }
  // A map with no sea at all still needs an exit: use the lowest edge cell.
  if (heap.size === 0) {
    let lowest = 0;
    for (let c = 0; c < cols; c++) for (const r of [0, rows - 1]) if (h[r * cols + c] < h[lowest]) lowest = r * cols + c;
    done[lowest] = 1;
    water[lowest] = WATER_SEA;
    heap.push(lowest, h[lowest]);
  }
  const order: number[] = []; // land cells from the sea outwards
  while (heap.size) {
    const i = heap.pop();
    const c = i % cols;
    const r = (i - c) / cols;
    for (let k = 0; k < 8; k++) {
      const nc = c + DC[k];
      const nr = r + DR[k];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (done[j]) continue;
      done[j] = 1;
      flowTo[j] = i;
      if (h[j] <= h[i]) {
        raised[j] = h[i] + EPS - h[j];
        h[j] = h[i] + EPS;
      }
      order.push(j);
      heap.push(j, h[j]);
    }
  }
  return { h, flowTo, order, raised };
}

// The route a gorge takes through a hollow: the cheapest path from where the water is
// (`start`, the pit or the point it spilled in at) to the spill point (where the flood's
// drainage route leaves the hollow), where cheap means low natural ground, so the gorge
// follows the valley floor instead of a straight line. Returns the cells after `start`,
// ending at the spill point.
export function valleyRoute(hw: Hollow, k: number, start: number, inHollow: Int32Array, h: ArrayLike<number>, flowTo: Int32Array, cols: number, rows: number): number[] {
  let spill = start;
  for (let guard = 0; guard < 1_000_000 && spill >= 0 && inHollow[spill] === k; guard++) spill = flowTo[spill];
  if (spill < 0) return [];
  const base = h[hw.pit];
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const heap = new MinHeap(hw.cells.length + 16);
  heap.push(start, 0);
  while (heap.size) {
    const i = heap.pop();
    if (i === spill) break;
    const d = dist.get(i)!;
    const c = i % cols;
    const r = (i - c) / cols;
    for (let q = 0; q < 8; q++) {
      const nc = c + DC[q];
      const nr = r + DR[q];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (j !== spill && inHollow[j] !== k) continue;
      const step = (q < 4 ? 1 : Math.SQRT2) * (0.002 + Math.max(0, h[j] - base));
      const nd = d + step;
      if (nd < (dist.get(j) ?? Infinity)) {
        dist.set(j, nd);
        prev.set(j, i);
        heap.push(j, nd);
      }
    }
  }
  if (!prev.has(spill)) return [];
  const route: number[] = [];
  for (let i = spill; i !== start; i = prev.get(i)!) route.push(i);
  return route.reverse();
}

interface Hollow {
  cells: number[];
  pit: number; // the lowest cell, before filling
  depth: number; // how far the flood had to fill it
  inland: boolean; // contains water that was below sea level
}

// Hollows: connected groups of cells the flood had to fill noticeably.
export function findHollows(raised: Float64Array, before: ArrayLike<number>, water: Uint8Array, inlandWater: Uint8Array, cols: number, rows: number): Hollow[] {
  const n = cols * rows;
  const MIN_FILL = 0.0003; // shallower than this is flat ground, not a hollow
  const seen = new Uint8Array(n);
  const out: Hollow[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || raised[s] < MIN_FILL || water[s] === WATER_SEA) continue;
    const cells: number[] = [];
    let pit = s;
    let depth = 0;
    let inland = false;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      if (before[i] < before[pit] || (before[i] === before[pit] && i < pit)) pit = i;
      depth = Math.max(depth, raised[i]);
      if (inlandWater[i]) inland = true;
      const c = i % cols;
      const r = (i - c) / cols;
      for (let k = 0; k < 4; k++) {
        const nc = c + DC[k];
        const nr = r + DR[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (seen[j] || raised[j] < MIN_FILL || water[j] === WATER_SEA) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    cells.sort((a, b) => a - b);
    out.push({ cells, pit, depth, inland });
  }
  return out;
}

// Sea is water that touches the map edge, directly or through other water. Water cut off
// from the edge is inland and becomes a lake later.
export function findSea(ls: LandSea, cols: number, rows: number): Uint8Array {
  const water = new Uint8Array(cols * rows);
  const stack: number[] = [];
  const add = (i: number) => {
    if (!ls.land[i] && !water[i]) {
      water[i] = WATER_SEA;
      stack.push(i);
    }
  };
  for (let c = 0; c < cols; c++) {
    add(c);
    add((rows - 1) * cols + c);
  }
  for (let r = 0; r < rows; r++) {
    add(r * cols);
    add(r * cols + cols - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % cols;
    const r = (i - c) / cols;
    if (c > 0) add(i - 1);
    if (c < cols - 1) add(i + 1);
    if (r > 0) add(i - cols);
    if (r < rows - 1) add(i + cols);
  }
  return water;
}

// Follow river cells downstream from each source until the water reaches the sea, a lake,
// or a river already drawn (a tributary joining a bigger river).
function traceRivers(cols: number, rows: number, water: Uint8Array, flowTo: Int32Array, flow: Float32Array, threshold: number): River[] {
  const n = cols * rows;
  const isRiver = (i: number) => water[i] === 0 && flow[i] >= threshold;
  const fedByRiver = new Uint8Array(n);
  const fedByLake = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const to = flowTo[i];
    if (to < 0 || !isRiver(to)) continue;
    if (isRiver(i)) fedByRiver[to] = 1;
    else if (water[i] === WATER_LAKE) fedByLake[to] = i;
  }
  // Sources: river cells with no river flowing into them. Start with the biggest rivers
  // so main stems are traced whole and tributaries end where they join them.
  const sources: number[] = [];
  for (let i = 0; i < n; i++) if (isRiver(i) && !fedByRiver[i]) sources.push(i);
  sources.sort((a, b) => downstreamLength(b, flowTo, isRiver) - downstreamLength(a, flowTo, isRiver));

  const drawn = new Uint8Array(n);
  const rivers: River[] = [];
  for (const s of sources) {
    const cells: number[] = [];
    // A river leaving a lake starts at the lake shore.
    if (fedByLake[s] >= 0) cells.push(fedByLake[s]);
    let i = s;
    let end: River["end"] = "sea";
    for (;;) {
      cells.push(i);
      if (drawn[i]) {
        end = "river";
        break;
      }
      drawn[i] = 1;
      const to = flowTo[i];
      if (to < 0) break;
      if (water[to] === WATER_SEA) {
        cells.push(to);
        end = "sea";
        break;
      }
      if (water[to] === WATER_LAKE) {
        cells.push(to);
        end = "lake";
        break;
      }
      i = to;
    }
    if (cells.length >= 3) rivers.push({ cells, flow: cells.map((c) => flow[c]), end });
  }
  return rivers;
}

function downstreamLength(i: number, flowTo: Int32Array, isRiver: (i: number) => boolean): number {
  let len = 0;
  while (i >= 0 && isRiver(i) && len < 100000) {
    len++;
    i = flowTo[i];
  }
  return len;
}

// Binary heap of cell indexes ordered by height, lowest first; ties by index so the
// result never depends on the order the browser happens to process things.
class MinHeap {
  private idx: Int32Array;
  private key: Float64Array;
  size = 0;
  constructor(capacity: number) {
    this.idx = new Int32Array(Math.max(16, capacity));
    this.key = new Float64Array(Math.max(16, capacity));
  }
  push(i: number, k: number) {
    if (this.size === this.idx.length) {
      // Grow when full (a path search can queue a cell more than once).
      const idx = new Int32Array(this.idx.length * 2);
      const key = new Float64Array(this.key.length * 2);
      idx.set(this.idx);
      key.set(this.key);
      this.idx = idx;
      this.key = key;
    }
    let p = this.size++;
    while (p > 0) {
      const parent = (p - 1) >> 1;
      if (this.less(this.key[parent], this.idx[parent], k, i)) break;
      this.idx[p] = this.idx[parent];
      this.key[p] = this.key[parent];
      p = parent;
    }
    this.idx[p] = i;
    this.key[p] = k;
  }
  pop(): number {
    const top = this.idx[0];
    const lastI = this.idx[--this.size];
    const lastK = this.key[this.size];
    let p = 0;
    for (;;) {
      let child = 2 * p + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.less(this.key[child + 1], this.idx[child + 1], this.key[child], this.idx[child])) child++;
      if (this.less(lastK, lastI, this.key[child], this.idx[child])) break;
      this.idx[p] = this.idx[child];
      this.key[p] = this.key[child];
      p = child;
    }
    this.idx[p] = lastI;
    this.key[p] = lastK;
    return top;
  }
  private less(ka: number, ia: number, kb: number, ib: number) {
    return ka < kb || (ka === kb && ia < ib);
  }
}

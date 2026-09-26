// River deltas (drawing only; the Deltas setting). Where one of the larger rivers meets the
// sea, a fan of low land is built out into the water, in two or three lobes, and the river
// splits a few cells inland into channels that branch across it to the new shore.
//
// This works on a copy of the water grid used only for drawing: the coast, ripple lines and
// stippling then wrap around the new land, while the generated map (symbols, towns, sea life)
// is untouched, so turning deltas on and off only redraws the map.

import type { Pt } from "./contours";
import { CELL } from "./heightmap";
import { WATER_SEA, type Hydrology, type River } from "./hydrology";

export interface Delta {
  river: River;
  split: number; // index in river.cells where the channels leave the river
  channels: DeltaChannel[];
  land: number[]; // cells of sea turned into delta land
}

// One channel, in grid units (a cell is 1 by 1, its centre at c + 0.5): a curve from `from`
// through `via` to `to` on the new shore. `branch`: 0 leaves the river itself, 1 leaves
// another channel part of the way along.
export interface DeltaChannel {
  from: Pt;
  via: Pt;
  to: Pt;
  branch: number;
}

const MOST = 6; // deltas on a map: the rivers carrying the most water
const SPLIT_BACK = 4; // cells inland of the mouth where the river splits

// `towns` (in map pixels, the map being `width` wide): a river reaching the sea at a town
// keeps its harbour mouth and gets no delta.
export function deltaPlan(hy: Hydrology, towns: { x: number; y: number }[] = [], width = hy.cols * CELL): { water: Uint8Array; deltas: Delta[] } {
  const { cols, rows } = hy;
  const water = hy.water.slice();
  const perCell = width / cols;
  const nearTown = (i: number) => towns.some((t) => Math.hypot(t.x / perCell - ((i % cols) + 0.5), t.y / perCell - (Math.floor(i / cols) + 0.5)) < 10);
  const mouths = hy.rivers.filter((r) => r.end === "sea" && r.cells.length >= SPLIT_BACK + 4 && !nearTown(r.cells[r.cells.length - 1]));
  const flowOf = (r: River) => r.flow[r.flow.length - 1];
  mouths.sort((a, b) => flowOf(b) - flowOf(a));
  const chosen = mouths.slice(0, MOST);
  const least = chosen.length ? flowOf(chosen[chosen.length - 1]) : 1;
  // Keep clear of the frame: the land never comes closer to it than the generator allows.
  const band = Math.ceil(Math.min(cols, rows) * 0.03) + 2;
  const centre = (i: number): Pt => [(i % cols) + 0.5, Math.floor(i / cols) + 0.5];
  const deltas: Delta[] = [];
  for (const r of chosen) {
    const mouthCell = r.cells[r.cells.length - 1];
    const mouth = centre(mouthCell);
    const back = centre(r.cells[Math.max(0, r.cells.length - 8)]);
    let dir = Math.atan2(mouth[1] - back[1], mouth[0] - back[0]);
    // Face the open sea: turn towards the side with more water around the mouth.
    dir = openSeaward(hy, mouth, dir);
    const reach = Math.min(12, 6 + 1.3 * Math.log2(Math.max(1, flowOf(r) / least)));
    const seed = r.cells[0] * 2654435761;
    const phase = rand(seed, 1) * Math.PI * 2;
    const lobes = 2 + (rand(seed, 2) < 0.5 ? 1 : 0);
    const spread = (75 * Math.PI) / 180;
    // The fan's radius at each angle: a broad arc, falling away at the shoulders into the
    // coast either side, its edge rounded into lobes.
    const radius = (a: number) => {
      const off = Math.atan2(Math.sin(a - dir), Math.cos(a - dir));
      const fall = Math.max(0, Math.cos((off / spread) * (Math.PI / 2))) ** 0.7;
      return reach * (0.1 + 0.9 * fall) * (0.75 + 0.25 * (0.5 + 0.5 * Math.cos(lobes * (off / spread) * Math.PI + phase)));
    };
    const land: number[] = [];
    const R = Math.ceil(reach) + 1;
    const [mc, mr] = [mouthCell % cols, Math.floor(mouthCell / cols)];
    for (let dr = -R; dr <= R; dr++)
      for (let dc = -R; dc <= R; dc++) {
        const c = mc + dc;
        const rr = mr + dr;
        if (c < band || rr < band || c >= cols - band || rr >= rows - band) continue;
        const i = rr * cols + c;
        if (water[i] !== WATER_SEA) continue;
        const a = Math.atan2(dr, dc);
        const off = Math.atan2(Math.sin(a - dir), Math.cos(a - dir));
        if (Math.abs(off) > spread) continue;
        if (Math.hypot(dc, dr) <= radius(dir + off) + 0.5) {
          water[i] = 0;
          land.push(i);
        }
      }
    // Fill slivers and pockets of sea the fan leaves between itself and the banks, so it
    // joins the land in one piece.
    for (let pass = 0; pass < 3; pass++) {
      const add: number[] = [];
      for (let dr = -R - 2; dr <= R + 2; dr++)
        for (let dc = -R - 2; dc <= R + 2; dc++) {
          const c = mc + dc;
          const rr = mr + dr;
          if (c < band || rr < band || c >= cols - band || rr >= rows - band) continue;
          const i = rr * cols + c;
          if (water[i] !== WATER_SEA) continue;
          let dry = 0;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((a || b) && water[(rr + a) * cols + c + b] !== WATER_SEA) dry++;
          if (dry >= 5) add.push(i);
        }
      for (const i of add) {
        water[i] = 0;
        land.push(i);
      }
    }
    if (land.length < 4) {
      for (const i of land) water[i] = WATER_SEA;
      continue;
    }
    // Channels: one down the middle, and one or two either side, each branching off the
    // channel next to it nearer the middle, so they form a tree.
    const split = r.cells.length - 1 - SPLIT_BACK;
    const start = centre(r.cells[split]);
    const count = reach >= 7.5 ? 5 : 4;
    const angles = Array.from({ length: count }, (_, k) => dir + (k / (count - 1) - 0.5) * 2 * spread * 0.62 + (rand(seed, 10 + k) - 0.5) * 0.18);
    // Where a channel heading out at angle `a` meets the sea: walk out from the mouth to the
    // first open water (none if the fan's edge there runs into the coast).
    const isSea = (x: number, y: number) => {
      const c = Math.floor(x);
      const rr = Math.floor(y);
      return c >= 0 && rr >= 0 && c < cols && rr < rows && water[rr * cols + c] === WATER_SEA;
    };
    const endOf = (a: number): Pt | null => {
      for (let d = 1; d <= reach + 3; d += 0.25) {
        const x = mouth[0] + Math.cos(a) * d;
        const y = mouth[1] + Math.sin(a) * d;
        if (isSea(x, y)) return [x, y];
      }
      return null;
    };
    const order = angles.map((a, k) => ({ a, k })).sort((p, q) => Math.abs(p.a - dir) - Math.abs(q.a - dir));
    const made = new Map<number, DeltaChannel>();
    for (const { a, k } of order) {
      const to = endOf(a);
      if (!to) continue;
      // The neighbour nearer the middle that is already made, if any.
      const inner = [k - 1, k + 1].filter((j) => made.has(j)).sort((p, q) => Math.abs(angles[p] - dir) - Math.abs(angles[q] - dir))[0];
      let from = start;
      let branch = 0;
      if (inner !== undefined && made.size > 1) {
        // Leave the neighbouring channel part of the way along it.
        const nb = made.get(inner)!;
        from = bezier(nb.from, nb.via, nb.to, 0.3 + 0.25 * rand(seed, 20 + k));
        branch = 1;
      }
      // Start off along the river's own heading, then turn towards the end, swinging a
      // little to one side on the way.
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const swing = (rand(seed, 30 + k) - 0.5) * 0.5 * len;
      const via: Pt = [from[0] + Math.cos(dir) * len * 0.45 - Math.sin(dir) * swing, from[1] + Math.sin(dir) * len * 0.45 + Math.cos(dir) * swing];
      made.set(k, { from, via, to, branch });
    }
    if (made.size < 2) {
      // Not a delta after all: leave the mouth as it was.
      for (const i of land) water[i] = WATER_SEA;
      continue;
    }
    deltas.push({ river: r, split, channels: [...made.values()], land });
  }
  return { water, deltas };
}

// A point along a quadratic curve.
export function bezier(a: Pt, b: Pt, c: Pt, t: number): Pt {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]];
}

// Turn a heading towards whichever side of it has more open sea within a few cells.
function openSeaward(hy: Hydrology, at: Pt, dir: number): number {
  let best = dir;
  let most = -1;
  for (const turn of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const a = dir + turn;
    let wet = 0;
    for (let d = 1; d <= 6; d++) {
      const c = Math.floor(at[0] + Math.cos(a) * d);
      const r = Math.floor(at[1] + Math.sin(a) * d);
      if (c >= 0 && r >= 0 && c < hy.cols && r < hy.rows && hy.water[r * hy.cols + c] === WATER_SEA) wet++;
    }
    // Prefer the river's own heading when it is as open as any.
    if (wet > most || (wet === most && Math.abs(turn) < Math.abs(best - dir))) {
      most = wet;
      best = a;
    }
  }
  return best;
}

function rand(seed: number, k: number): number {
  let h = Math.imul(seed ^ Math.imul(k, 0x9e3779b9), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

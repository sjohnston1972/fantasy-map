// Stage 8: render (spec step 8: "Everything is drawn as SVG line art, ready to view, edit
// or export"). Black ink on white paper: an inked coastline with ripple lines out to sea,
// lake shores, rivers that widen downstream, and the symbols. Symbols are placeholder
// shapes until the real ink symbol packs arrive (milestone 7).

import { outlines, simplify, smoothLoop, type Pt } from "./contours";
import { WATER_LAKE, WATER_SEA, type Hydrology } from "./hydrology";
import type { PlacedSymbol } from "./symbols";

export interface SvgInput {
  width: number;
  height: number;
  water: Hydrology;
  symbols: PlacedSymbol[];
}

const INK = "#1a1714";

export function renderSvg(m: SvgInput): string {
  const { width: W, height: H, water: hy } = m;
  const sx = W / hy.cols;
  const sy = H / hy.rows;
  const toMap = (loop: Pt[]): Pt[] => loop.map(([x, y]) => [x * sx, y * sy]);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-generator="ink-fantasy-maps">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);

  // Ripple lines in the sea, following the coast at two distances (engraved-map style).
  const seaDist = distanceFrom(hy, (i) => hy.water[i] !== WATER_SEA);
  for (const [d, width] of [[2, 0.9], [4.5, 0.6]] as const) {
    const loops = outlines(hy.cols, hy.rows, (i) => hy.water[i] !== WATER_SEA || seaDist[i] <= d).map((l) => toMap(smoothLoop(l, 3)));
    parts.push(`<path d="${pathOf(loops)}" fill="none" stroke="${INK}" stroke-width="${width}" stroke-opacity="0.8"/>`);
  }

  // Land, with a bold coastline.
  const land = outlines(hy.cols, hy.rows, (i) => hy.water[i] !== WATER_SEA).map((l) => toMap(smoothLoop(l, 3)));
  parts.push(`<path d="${pathOf(land)}" fill="#fff" fill-rule="evenodd" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`);

  // Lakes: shore line and one ripple inside.
  const lakes = outlines(hy.cols, hy.rows, (i) => hy.water[i] === WATER_LAKE).map((l) => toMap(smoothLoop(l, 3)));
  if (lakes.length) {
    parts.push(`<path d="${pathOf(lakes)}" fill="#fff" fill-rule="evenodd" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`);
    const lakeDist = distanceFrom(hy, (i) => hy.water[i] !== WATER_LAKE);
    const inner = outlines(hy.cols, hy.rows, (i) => hy.water[i] === WATER_LAKE && lakeDist[i] > 2).map((l) => toMap(smoothLoop(l, 3)));
    if (inner.length) parts.push(`<path d="${pathOf(inner)}" fill="none" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.8"/>`);
  }

  // Rivers: filled ribbons, hairline at the source and widening with the water carried.
  parts.push(`<g fill="${INK}">`);
  const minFlow = Math.min(...hy.rivers.map((r) => r.flow[0] ?? Infinity));
  for (const r of hy.rivers) {
    let pts = r.cells.map((i) => [((i % hy.cols) + 0.5) * sx, (Math.floor(i / hy.cols) + 0.5) * sy] as Pt);
    for (let k = 0; k < 3; k++) pts = smoothLine(pts); // three passes hide the grid's staircase
    const px = W / 1600; // line weights are set for a 1600 px wide map
    const widths = pts.map((_, k) => {
      const f = r.flow[Math.min(r.flow.length - 1, Math.floor((k / pts.length) * r.flow.length))];
      return Math.min(3.4, 0.7 + 0.4 * Math.log2(Math.max(1, f / minFlow))) * px;
    });
    parts.push(`<path d="${ribbon(pts, widths)}"/>`);
  }
  parts.push(`</g>`);

  // Symbols, back to front.
  parts.push(`<g stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">`);
  m.symbols.forEach((s, k) => parts.push(placeholder(s, k)));
  parts.push(`</g>`);

  // A double-ruled border, as on old engraved maps.
  parts.push(`<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${INK}" stroke-width="3"/>`);
  parts.push(`<rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${INK}" stroke-width="1"/>`);
  parts.push(`</svg>`);
  return parts.join("");
}

// Simple stand-in drawings, one per role, anchored at the middle of the base.
function placeholder(s: PlacedSymbol, k: number): string {
  const { x, y, w, h } = s;
  const f = s.flip ? -1 : 1;
  const n = (v: number) => v.toFixed(1);
  const g = (inner: string) => `<g data-sym="${k}" data-role="${s.role}">${inner}</g>`;
  switch (s.role) {
    case "mountain": {
      // Triangle with hatching on the right-hand slope (light from the top left).
      const ax = x + f * w * 0.05;
      const lines: string[] = [];
      for (let t = 0.25; t < 0.95; t += 0.18) lines.push(`M${n(ax + (x + w / 2 - ax) * t)} ${n(y - h + h * t)}L${n(ax + (x + w / 2 - ax) * t - w * 0.12)} ${n(y)}`);
      return g(`<path d="M${n(x - w / 2)} ${n(y)}L${n(ax)} ${n(y - h)}L${n(x + w / 2)} ${n(y)}Z" fill="#fff" stroke-width="1.4"/><path d="${lines.join("")}" fill="none" stroke-width="0.7"/>`);
    }
    case "hill":
      return g(`<path d="M${n(x - w / 2)} ${n(y)}Q${n(x)} ${n(y - h * 2)} ${n(x + w / 2)} ${n(y)}" fill="#fff" stroke-width="1.2"/><path d="M${n(x + w * 0.1)} ${n(y - h * 0.7)}Q${n(x + w * 0.3)} ${n(y - h * 0.4)} ${n(x + w * 0.35)} ${n(y - h * 0.1)}" fill="none" stroke-width="0.6"/>`);
    case "conifer":
      return g(`<path d="M${n(x)} ${n(y)}V${n(y - h * 0.2)}" stroke-width="0.9"/><path d="M${n(x - w / 2)} ${n(y - h * 0.2)}L${n(x)} ${n(y - h)}L${n(x + w / 2)} ${n(y - h * 0.2)}Z" fill="#fff" stroke-width="0.9"/>`);
    case "broadleaf":
      return g(`<path d="M${n(x)} ${n(y)}V${n(y - h * 0.35)}" stroke-width="0.9"/><circle cx="${n(x)}" cy="${n(y - h + w / 2)}" r="${n(w / 2)}" fill="#fff" stroke-width="0.9"/>`);
    case "reeds":
      return g(`<path d="M${n(x - w * 0.3)} ${n(y)}L${n(x - w * 0.4)} ${n(y - h * 0.8)}M${n(x)} ${n(y)}V${n(y - h)}M${n(x + w * 0.3)} ${n(y)}L${n(x + w * 0.4)} ${n(y - h * 0.8)}M${n(x - w / 2)} ${n(y)}H${n(x + w / 2)}" fill="none" stroke-width="0.8"/>`);
    case "dune":
      return g(`<path d="M${n(x - w / 2)} ${n(y)}Q${n(x - f * w * 0.1)} ${n(y - h * 2)} ${n(x + w / 2)} ${n(y)}" fill="none" stroke-width="0.9"/>`);
    case "cactus":
      return g(`<path d="M${n(x)} ${n(y)}V${n(y - h)}M${n(x)} ${n(y - h * 0.45)}H${n(x - w / 2)}V${n(y - h * 0.75)}M${n(x)} ${n(y - h * 0.6)}H${n(x + w / 2)}V${n(y - h * 0.85)}" fill="none" stroke-width="0.9"/>`);
    case "grass":
      return g(`<path d="M${n(x - w / 2)} ${n(y - h * 0.6)}L${n(x - w * 0.2)} ${n(y)}M${n(x)} ${n(y - h)}V${n(y)}M${n(x + w / 2)} ${n(y - h * 0.6)}L${n(x + w * 0.2)} ${n(y)}" fill="none" stroke-width="0.7"/>`);
    case "snow":
      return g(`<path d="M${n(x - w / 2)} ${n(y)}H${n(x - w * 0.1)}M${n(x + w * 0.05)} ${n(y - h * 0.5)}H${n(x + w / 2)}" fill="none" stroke-width="0.7"/>`);
  }
}

// Distance in cells from the nearest cell where `source` is true (breadth-first).
function distanceFrom(hy: Hydrology, source: (i: number) => boolean): Float32Array {
  const { cols, rows } = hy;
  const n = cols * rows;
  const dist = new Float32Array(n).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (source(i)) (dist[i] = 0), queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const c = i % cols;
    const r = (i - c) / cols;
    const d = dist[i] + 1;
    if (d > 8) continue;
    for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1]) {
      if (j >= 0 && dist[j] > d) {
        dist[j] = d;
        queue.push(j);
      }
    }
  }
  return dist;
}

// Outlines as SVG path data, with points that do not change the shape left out.
function pathOf(loops: Pt[][]): string {
  return loops.map((l) => "M" + simplify(l, 0.25).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z").join("");
}

// One Chaikin pass on an open line, keeping both ends.
function smoothLine(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// A filled strip along a line, `widths[k]` wide at point k: down one side, back up the other.
function ribbon(pts: Pt[], widths: number[]): string {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let k = 0; k < pts.length; k++) {
    const [ax, ay] = pts[Math.max(0, k - 1)];
    const [bx, by] = pts[Math.min(pts.length - 1, k + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const hw = widths[k] / 2;
    left.push([pts[k][0] + nx * hw, pts[k][1] + ny * hw]);
    right.push([pts[k][0] - nx * hw, pts[k][1] - ny * hw]);
  }
  const all = [...simplify(left, 0.2), ...simplify(right.reverse(), 0.2)];
  return "M" + all.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";
}

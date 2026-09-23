// Stage 8: render (spec step 8: "Everything is drawn as SVG line art, ready to view, edit
// or export"). Black ink on white paper: an inked coastline with ripple lines out to sea,
// lake shores, rivers that widen downstream, and the symbols. Symbols are placeholder
// shapes until the real ink symbol packs arrive (milestone 7).

import { outlines, simplify, smoothLoop, type Pt } from "./contours";
import { WATER_LAKE, WATER_SEA, type Hydrology } from "./hydrology";
import { pickSymbol, type InkSet, type InkSymbol } from "./inkset";
import type { Labelling } from "./labels";
import type { Settlements } from "./settlements";
import type { PlacedSymbol } from "./symbols";

export interface SvgInput {
  width: number;
  height: number;
  water: Hydrology;
  symbols: PlacedSymbol[];
  towns?: Settlements;
  ink?: InkSet; // hand-inked symbols; placeholders are drawn for any role without them
  labels?: Labelling;
  fontCss?: string; // embedded @font-face rules, for SVG files saved outside the page
}

const INK = "#1a1714";

// The ground (sea ripples, coast, lakes, rivers, roads) takes most of the drawing time and
// never changes while a map is edited, so it is drawn once per map and reused.
const baseCache = new WeakMap<Hydrology, { roads: unknown; svg: string }>();

// Stand-in variant for items whose drawing is chosen by position (towns, landmarks,
// bridges): the same place always gets the same drawing, unless the user swaps it.
const hashVariant = (cell: number, salt: number) => (((cell * salt) >>> 0) % 4294967296) / 4294967296;

export function renderSvg(m: SvgInput): string {
  const { width: W, height: H, water: hy } = m;
  const px = W / 1600;
  const parts: string[] = [];
  const defs = new InkDefs();
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-generator="ink-fantasy-maps">`);
  if (m.fontCss) parts.push(`<style>${m.fontCss}</style>`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);

  const cached = baseCache.get(hy);
  const roads = m.towns?.roads ?? null;
  let base = cached && cached.roads === roads ? cached.svg : "";
  if (!base) {
    base = renderBase(W, H, hy, m.towns);
    baseCache.set(hy, { roads, svg: base });
  }
  parts.push(base);

  if (m.towns) {
    m.towns.bridges.forEach((b, k) => {
      const key = `bridge:${b.index ?? k}`;
      const bridge = pickSymbol(m.ink, "bridge", b.variant ?? hashVariant(b.cell, 2654435761));
      if (bridge) {
        // Drawn upright over the crossing, centred on the river.
        const bw = 24 * px;
        parts.push(`<g data-key="${key}" data-role="bridge">${defs.use(bridge, b.x, b.y + (bw * bridge.h) / bridge.w / 2, bw, bw, false, W)}</g>`);
        return;
      }
      const deg = (b.angle * 180) / Math.PI;
      const L = 9 * px;
      const Wd = 5 * px;
      parts.push(
        `<g data-key="${key}" transform="translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${deg.toFixed(1)})" data-role="bridge">` +
          `<rect x="${(-L / 2).toFixed(1)}" y="${(-Wd / 2).toFixed(1)}" width="${L.toFixed(1)}" height="${Wd.toFixed(1)}" fill="#fff" stroke="none"/>` +
          `<path d="M${(-L / 2).toFixed(1)} ${(-Wd / 2).toFixed(1)}H${(L / 2).toFixed(1)}M${(-L / 2).toFixed(1)} ${(Wd / 2).toFixed(1)}H${(L / 2).toFixed(1)}" stroke="${INK}" stroke-width="${(1.2 * px).toFixed(2)}"/></g>`,
      );
    });
  }

  // Symbols, back to front.
  parts.push(`<g stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">`);
  m.symbols.forEach((s, k) => {
    const key = (s as PlacedSymbol & { key?: string }).key ?? `sym:${k}`;
    const icon = pickSymbol(m.ink, s.role, s.variant);
    parts.push(icon ? `<g data-key="${key}" data-sym="${key.slice(4)}" data-role="${s.role}">${defs.use(icon, s.x, s.y, s.w, s.h, s.flip, W)}</g>` : placeholder(s, k, key));
  });
  parts.push(`</g>`);

  // Landmarks and settlements (dots with a ringed capital until the town symbols load).
  if (m.towns) {
    for (const l of m.towns.landmarks) {
      const icon = pickSymbol(m.ink, "landmark", l.variant ?? hashVariant(l.cell, 2246822519));
      const lw = 30 * px;
      const key = `landmark:${l.id}`;
      parts.push(icon ? `<g data-key="${key}" data-landmark="${l.id}">${defs.use(icon, l.x, l.y, lw, lw, false, W)}</g>` : `<g data-key="${key}" data-landmark="${l.id}"><path d="M${(l.x - 4 * px).toFixed(1)} ${l.y.toFixed(1)}V${(l.y - 14 * px).toFixed(1)}H${(l.x + 4 * px).toFixed(1)}V${l.y.toFixed(1)}Z" fill="#fff" stroke="${INK}" stroke-width="${(1.2 * px).toFixed(2)}"/></g>`);
    }
    for (const p of m.towns.places) {
      const key = `town:${p.id}`;
      const townIcon = pickSymbol(m.ink, p.tier, p.variant ?? hashVariant(p.cell, 2654435761));
      if (townIcon) {
        const tw = (p.tier === "capital" ? 74 : p.tier === "town" ? 56 : 40) * px;
        parts.push(`<g data-key="${key}" data-town="${p.id}" data-tier="${p.tier}">${defs.use(townIcon, p.x, p.y + tw * 0.12, tw, tw, false, W)}</g>`);
        continue;
      }
      const r = (p.tier === "capital" ? 10 : p.tier === "town" ? 7.5 : 5) * px;
      const ring = p.tier === "capital" ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(r + 4 * px).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="${(1.1 * px).toFixed(2)}"/>` : "";
      parts.push(`<g data-key="${key}" data-town="${p.id}" data-tier="${p.tier}"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${p.tier === "village" ? "#fff" : INK}" stroke="${INK}" stroke-width="${(1.3 * px).toFixed(2)}"/>${ring}</g>`);
    }
  }

  // Emblems: heraldic banners beside the capital and the chief towns.
  if (m.labels) {
    m.labels.emblems.forEach((e, k) => {
      const key = `emblem:${e.index ?? k}`;
      const icon = pickSymbol(m.ink, "emblem", e.variant);
      if (icon) {
        parts.push(`<g data-key="${key}" data-emblem="${e.town}">${defs.use(icon, e.x, e.y, e.w, e.w * 1.25, false, W)}</g>`);
        return;
      }
      const x0 = e.x - e.w / 2;
      const top = e.y - e.w * 1.2;
      parts.push(`<g data-key="${key}" data-emblem="${e.town}"><path d="M${x0.toFixed(1)} ${top.toFixed(1)}H${(x0 + e.w).toFixed(1)}V${(top + e.w * 0.7).toFixed(1)}Q${(x0 + e.w).toFixed(1)} ${(top + e.w * 1.1).toFixed(1)} ${e.x.toFixed(1)} ${(top + e.w * 1.2).toFixed(1)}Q${x0.toFixed(1)} ${(top + e.w * 1.1).toFixed(1)} ${x0.toFixed(1)} ${(top + e.w * 0.7).toFixed(1)}Z" fill="#fff" stroke="${INK}" stroke-width="${(1.4 * px).toFixed(2)}"/></g>`);
    });
  }

  // Lettering, on top of everything, each with a white outline so it reads over the ink.
  if (m.labels) {
    const riverPaths: string[] = [];
    parts.push(`<g font-family="'IM Fell English', Georgia, 'Times New Roman', serif" fill="${INK}" stroke="#fff" stroke-linejoin="round" paint-order="stroke">`);
    for (const l of m.labels.labels) {
      const key = `label:${l.id}`;
      const text = escapeXml(l.caps ? l.text.toUpperCase() : l.text);
      const style = `font-size="${l.size.toFixed(1)}"${l.italic ? ' font-style="italic"' : ""}${l.spacing ? ` letter-spacing="${(l.spacing * l.size).toFixed(1)}"` : ""} stroke-width="${(l.size * 0.22).toFixed(1)}"`;
      if (l.path) {
        const id = `rl${l.id}`;
        riverPaths.push(`<path id="${id}" d="M${l.path.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}"/>`);
        parts.push(`<text data-key="${key}" data-label="${l.id}" data-kind="${l.kind}" ${style}><textPath href="#${id}">${text}</textPath></text>`);
      } else {
        parts.push(`<text data-key="${key}" data-label="${l.id}" data-kind="${l.kind}" x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="${l.anchor}" ${style}>${text}</text>`);
      }
    }
    parts.push(`</g>`);
    if (riverPaths.length) parts.push(`<defs>${riverPaths.join("")}</defs>`);
  }

  // A double-ruled border, as on old engraved maps.
  parts.push(`<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${INK}" stroke-width="3"/>`);
  parts.push(`<rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${INK}" stroke-width="1"/>`);
  parts.push(`</svg>`);
  // Drawings used on this map, defined once and reused by reference.
  parts.splice(1, 0, defs.markup());
  return parts.join("");
}

// Sea ripples, land, lakes, rivers and roads.
function renderBase(W: number, H: number, hy: Hydrology, towns?: Settlements): string {
  const sx = W / hy.cols;
  const sy = H / hy.rows;
  const px = W / 1600;
  const toMap = (loop: Pt[]): Pt[] => loop.map(([x, y]) => [x * sx, y * sy]);
  const parts: string[] = [];

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
    const widths = pts.map((_, k) => {
      const f = r.flow[Math.min(r.flow.length - 1, Math.floor((k / pts.length) * r.flow.length))];
      return Math.min(2.6, 0.6 + 0.3 * Math.log2(Math.max(1, f / minFlow))) * px;
    });
    parts.push(`<path d="${ribbon(pts, widths)}"/>`);
  }
  parts.push(`</g>`);

  // Roads: dashed lines.
  if (towns) {
    const roadPaths = towns.roads.map((road) => {
      let pts = road.cells.map((i) => [((i % hy.cols) + 0.5) * sx, (Math.floor(i / hy.cols) + 0.5) * sy] as Pt);
      for (let k = 0; k < 3; k++) pts = smoothLine(pts);
      return "M" + simplify(pts, 0.3).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
    });
    parts.push(`<path d="${roadPaths.join("")}" fill="none" stroke="${INK}" stroke-width="${(1.9 * px).toFixed(2)}" stroke-dasharray="${(7 * px).toFixed(1)} ${(4.5 * px).toFixed(1)}" stroke-linecap="round"/>`);
  }
  return parts.join("");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Each hand-inked drawing is defined once in <defs> and placed with <use>. Every placement
// is drawn twice: a white outline first (the knockout, so symbols in front hide the lines
// of those behind, as an engraver would leave them out), then the ink.
class InkDefs {
  private ids = new Map<string, string>();
  private symbols: string[] = [];
  private ref(icon: InkSymbol): string {
    let id = this.ids.get(icon.id);
    if (!id) {
      // Named after the drawing, so an item keeps its reference when others are edited.
      id = `i-${icon.id.replace(/[^\w-]/g, "_")}`;
      this.ids.set(icon.id, id);
      this.symbols.push(`<symbol id="${id}" viewBox="${icon.viewBox}">${icon.body}</symbol>`);
    }
    return id;
  }
  // Fit the drawing inside a w by h box standing on (x, y), with its anchor on that point.
  use(icon: InkSymbol, x: number, y: number, w: number, h: number, flip: boolean, mapWidth: number): string {
    const id = this.ref(icon);
    const k = Math.min(w / icon.w, h / icon.h);
    const dw = icon.w * k;
    const dh = icon.h * k;
    const left = x - icon.anchorX * dw;
    const top = y - icon.anchorY * dh;
    const f = (v: number) => v.toFixed(1);
    // The traced paths are drawn at a tenth of their own units (potrace), so the knockout
    // stroke is set in those units: about 1.3 map pixels wide.
    const halo = (1.3 * (mapWidth / 1600)) / (0.1 * k);
    const mirror = flip ? ` transform="translate(${f(2 * x)} 0) scale(-1 1)"` : "";
    const at = `href="#${id}" x="${f(left)}" y="${f(top)}" width="${f(dw)}" height="${f(dh)}"`;
    return `<g${mirror}><use ${at} color="#fff" stroke="#fff" stroke-width="${halo.toFixed(1)}" stroke-linejoin="round"/><use ${at} color="${INK}" stroke="none"/></g>`;
  }
  markup(): string {
    return this.symbols.length ? `<defs>${this.symbols.join("")}</defs>` : "";
  }
}

// Simple stand-in drawings, one per role, anchored at the middle of the base.
function placeholder(s: PlacedSymbol, k: number, key: string): string {
  const { x, y, w, h } = s;
  const f = s.flip ? -1 : 1;
  const n = (v: number) => v.toFixed(1);
  const g = (inner: string) => `<g data-key="${key}" data-sym="${key.slice(4)}" data-role="${s.role}">${inner}</g>`;
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
    case "field":
      // A little ploughed field: an outline with furrows.
      return g(`<path d="M${n(x - w / 2)} ${n(y)}L${n(x - w * 0.35)} ${n(y - h)}H${n(x + w * 0.45)}L${n(x + w / 2)} ${n(y)}Z" fill="#fff" stroke-width="0.6"/><path d="M${n(x - w * 0.25)} ${n(y - h * 0.15)}L${n(x - w * 0.15)} ${n(y - h * 0.85)}M${n(x)} ${n(y - h * 0.15)}L${n(x + w * 0.05)} ${n(y - h * 0.85)}M${n(x + w * 0.25)} ${n(y - h * 0.15)}L${n(x + w * 0.25)} ${n(y - h * 0.85)}" fill="none" stroke-width="0.4"/>`);
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

// Which drawing an item on the map uses: its role in the symbol packs and its variant
// number (0 to 1). The editor uses this to swap an item to the next drawing of its kind.
export function drawingOf(m: Pick<SvgInput, "symbols" | "towns" | "labels">, key: string): { role: string; variant: number } | null {
  const [kind, idText] = key.split(":");
  const id = Number(idText);
  if (kind === "sym") {
    const s = m.symbols.find((s, k) => ((s as PlacedSymbol & { key?: string }).key ?? `sym:${k}`) === key);
    return s ? { role: s.role, variant: s.variant } : null;
  }
  if (kind === "town") {
    const p = m.towns?.places.find((p) => p.id === id);
    return p ? { role: p.tier, variant: p.variant ?? hashVariant(p.cell, 2654435761) } : null;
  }
  if (kind === "landmark") {
    const l = m.towns?.landmarks.find((l) => l.id === id);
    return l ? { role: "landmark", variant: l.variant ?? hashVariant(l.cell, 2246822519) } : null;
  }
  if (kind === "bridge") {
    const b = m.towns?.bridges.find((b, k) => (b.index ?? k) === id);
    return b ? { role: "bridge", variant: b.variant ?? hashVariant(b.cell, 2654435761) } : null;
  }
  if (kind === "emblem") {
    const e = m.labels?.emblems.find((e, k) => (e.index ?? k) === id);
    return e ? { role: "emblem", variant: e.variant } : null;
  }
  return null; // labels have no drawing
}

// Stage 8: render (spec step 8: "Everything is drawn as SVG line art, ready to view, edit
// or export"). Black ink on white paper: an inked coastline with ripple lines out to sea,
// lake shores, rivers that widen downstream, and the symbols. Symbols are placeholder
// shapes until the real ink symbol packs arrive (milestone 7).

import { outlines, simplify, smoothLoop, type Pt } from "./contours";
import { WATER_LAKE, WATER_SEA, type Hydrology } from "./hydrology";
import { pickSymbol, type InkSet, type InkSymbol } from "./inkset";
import { compassBox, textWidth, titleFrame, type Emblem, type Label, type Labelling } from "./labels";
import type { Bridge, Landmark, Settlement, Settlements } from "./settlements";
import type { Border, Coast } from "./settings";
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
  border?: Border; // frame style (classic when left out)
  coast?: Coast; // how the sea is drawn along the shore (ripples when left out)
  sprites?: Map<string, Sprite>; // pre-drawn pictures of drawings, for the map on screen only
}

// A drawing pre-drawn as a picture (see src/app/sprites.ts): its address, and the room
// around the drawing for its white outline, as a share of the drawing's width and height.
export interface Sprite {
  href: string;
  padX: number;
  padY: number;
}

const INK = "#1a1714";

// The ground (sea ripples, coast, lakes, rivers, roads) takes most of the drawing time and
// never changes while a map is edited, so it is drawn once per map and reused.
const baseCache = new WeakMap<Hydrology, { roads: unknown; coast: Coast; svg: string }>();

// Stand-in variant for items whose drawing is chosen by position (towns, landmarks,
// bridges): the same place always gets the same drawing, unless the user swaps it.
const hashVariant = (cell: number, salt: number) => (((cell * salt) >>> 0) % 4294967296) / 4294967296;

// The frame. Like a printed map, the drawing sits inside a double-ruled border with plain
// paper outside it: nothing is drawn in the margin, and the drawing is cut off cleanly at the
// inner rule. The generated map is scaled down a little (about 6%) to fit inside, so the map
// itself (and every share link) stays exactly the same.
export interface Frame {
  margin: number; // plain paper outside the outer rule
  outer: { x: number; y: number; w: number; h: number }; // outer (thick) rule
  inner: { x: number; y: number; w: number; h: number }; // inner (thin) rule: the drawing's edge
  scale: number; // map pixels to page pixels inside the frame
  dx: number; // where the scaled map's corner sits
  dy: number;
}

export function frameFor(W: number, H: number): Frame {
  const margin = Math.round(0.025 * Math.min(W, H)); // about 7 mm on A3
  const gap = Math.max(4, Math.round(0.005 * Math.min(W, H))); // between the two rules
  const outer = { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin };
  const inset = margin + gap;
  const inner = { x: inset, y: inset, w: W - 2 * inset, h: H - 2 * inset };
  const scale = Math.min(inner.w / W, inner.h / H);
  return { margin, outer, inner, scale, dx: inner.x + (inner.w - W * scale) / 2, dy: inner.y + (inner.h - H * scale) / 2 };
}

export function renderSvg(m: SvgInput): string {
  const { width: W, height: H, water: hy } = m;
  const px = W / 1600;
  const parts: string[] = [];
  const defs = new InkDefs(m.sprites);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-generator="ink-fantasy-maps">`);
  if (m.fontCss) parts.push(`<style>${m.fontCss}</style>`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  const fr = frameFor(W, H);
  const f = (v: number) => +v.toFixed(3);
  parts.push(`<clipPath id="frame-clip"><rect x="${fr.inner.x}" y="${fr.inner.y}" width="${fr.inner.w}" height="${fr.inner.h}"/></clipPath>`);
  parts.push(`<g clip-path="url(#frame-clip)"><g data-content="1" transform="translate(${f(fr.dx)} ${f(fr.dy)}) scale(${f(fr.scale)})">`);

  const cached = baseCache.get(hy);
  const roads = m.towns?.roads ?? null;
  const coast = m.coast ?? "ripples";
  let base = cached && cached.roads === roads && cached.coast === coast ? cached.svg : "";
  if (!base) {
    base = renderBase(W, H, hy, m.towns, coast);
    baseCache.set(hy, { roads, coast, svg: base });
  }
  parts.push(base);

  // The items drawn over the ground, each layer in its own group so the editor can redraw one
  // item and put it back in its place (renderItems, below).
  const draw = itemDrawer(m, defs);
  if (m.towns) {
    parts.push(`<g data-layer="bridges">`);
    m.towns.bridges.forEach((b, k) => parts.push(draw.bridge(b, k)));
    parts.push(`</g>`);
  }

  // Symbols, back to front.
  parts.push(`<g data-layer="symbols" stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">`);
  m.symbols.forEach((s, k) => parts.push(draw.symbol(s, k)));
  parts.push(`</g>`);

  // Landmarks and settlements (dots with a ringed capital until the town symbols load).
  if (m.towns) {
    parts.push(`<g data-layer="places">`);
    for (const l of m.towns.landmarks) parts.push(draw.landmark(l));
    for (const p of m.towns.places) parts.push(draw.town(p));
    parts.push(`</g>`);
  }

  // Emblems: heraldic banners beside the capital and the chief towns.
  if (m.labels) {
    parts.push(`<g data-layer="emblems">`);
    m.labels.emblems.forEach((e, k) => parts.push(draw.emblem(e, k)));
    parts.push(`</g>`);
  }

  // Lettering, on top of everything, each with a white outline so it reads over the ink.
  if (m.labels) {
    const riverPaths: string[] = [];
    parts.push(`<g data-layer="labels" ${LABEL_STYLE}>`);
    for (const l of m.labels.labels) {
      const { markup, path } = draw.label(l);
      parts.push(markup);
      if (path) riverPaths.push(path);
    }
    parts.push(`</g>`);
    parts.push(`<defs data-layer="river-paths">${riverPaths.join("")}</defs>`);
  }

  parts.push(`</g></g>`);

  // The frame, with plain paper outside it.
  parts.push(frameMarkup(fr, m.border ?? "classic", px));
  parts.push(`</svg>`);
  // Drawings used on this map, defined once and reused by reference.
  parts.splice(1, 0, defs.markup());
  return parts.join("");
}

const LABEL_STYLE = `font-family="'IM Fell English', Georgia, 'Times New Roman', serif" fill="${INK}" stroke="#fff" stroke-linejoin="round" paint-order="stroke"`;

// Markup for each kind of item on the map. renderSvg draws them all; renderItems redraws a
// few after an edit. Both go through here, so a redrawn item is exactly what a full drawing
// would have produced.
function itemDrawer(m: SvgInput, defs: InkDefs) {
  const W = m.width;
  const px = W / 1600;
  return {
    bridge(b: Bridge, k: number): string {
      const key = `bridge:${b.index ?? k}`;
      const bridge = pickSymbol(m.ink, "bridge", b.variant ?? hashVariant(b.cell, 2654435761));
      if (bridge) {
        // Drawn upright over the crossing, centred on the river.
        const bw = 24 * px * (b.size ?? 1);
        return `<g data-key="${key}" data-role="bridge">${defs.use(bridge, b.x, b.y + (bw * bridge.h) / bridge.w / 2, bw, bw, false, W)}</g>`;
      }
      const deg = (b.angle * 180) / Math.PI;
      const L = 9 * px;
      const Wd = 5 * px;
      return (
        `<g data-key="${key}" transform="translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${deg.toFixed(1)})" data-role="bridge">` +
        `<rect x="${(-L / 2).toFixed(1)}" y="${(-Wd / 2).toFixed(1)}" width="${L.toFixed(1)}" height="${Wd.toFixed(1)}" fill="#fff" stroke="none"/>` +
        `<path d="M${(-L / 2).toFixed(1)} ${(-Wd / 2).toFixed(1)}H${(L / 2).toFixed(1)}M${(-L / 2).toFixed(1)} ${(Wd / 2).toFixed(1)}H${(L / 2).toFixed(1)}" stroke="${INK}" stroke-width="${(1.2 * px).toFixed(2)}"/></g>`
      );
    },
    symbol(s: PlacedSymbol, k: number): string {
      const key = s.key ?? `sym:${k}`;
      const icon = pickSymbol(m.ink, s.role, s.variant);
      const name = s.name ? addedName(s) : "";
      if (icon) return `<g data-key="${key}" data-sym="${key.slice(4)}" data-role="${s.role}">${defs.use(icon, s.x, s.y, s.w, s.h, s.flip, W)}${name}</g>`;
      return name ? placeholder(s, k, key).replace(/<\/g>$/, `${name}</g>`) : placeholder(s, k, key);
    },
    landmark(l: Landmark): string {
      const icon = pickSymbol(m.ink, "landmark", l.variant ?? hashVariant(l.cell, 2246822519));
      const lw = 30 * px * (l.size ?? 1);
      const key = `landmark:${l.id}`;
      return icon ? `<g data-key="${key}" data-landmark="${l.id}">${defs.use(icon, l.x, l.y, lw, lw, false, W)}</g>` : `<g data-key="${key}" data-landmark="${l.id}"><path d="M${(l.x - 4 * px).toFixed(1)} ${l.y.toFixed(1)}V${(l.y - 14 * px).toFixed(1)}H${(l.x + 4 * px).toFixed(1)}V${l.y.toFixed(1)}Z" fill="#fff" stroke="${INK}" stroke-width="${(1.2 * px).toFixed(2)}"/></g>`;
    },
    town(p: Settlement): string {
      const key = `town:${p.id}`;
      const townIcon = pickSymbol(m.ink, p.tier, p.variant ?? hashVariant(p.cell, 2654435761));
      if (townIcon) {
        const tw = (p.tier === "capital" ? 74 : p.tier === "town" ? 56 : 40) * px * (p.size ?? 1);
        return `<g data-key="${key}" data-town="${p.id}" data-tier="${p.tier}">${defs.use(townIcon, p.x, p.y + tw * 0.12, tw, tw, false, W)}</g>`;
      }
      const r = (p.tier === "capital" ? 10 : p.tier === "town" ? 7.5 : 5) * px * (p.size ?? 1);
      const ring = p.tier === "capital" ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(r + 4 * px).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="${(1.1 * px).toFixed(2)}"/>` : "";
      return `<g data-key="${key}" data-town="${p.id}" data-tier="${p.tier}"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${p.tier === "village" ? "#fff" : INK}" stroke="${INK}" stroke-width="${(1.3 * px).toFixed(2)}"/>${ring}</g>`;
    },
    emblem(e: Emblem, k: number): string {
      const key = `emblem:${e.index ?? k}`;
      const icon = pickSymbol(m.ink, "emblem", e.variant);
      if (icon) return `<g data-key="${key}" data-emblem="${e.town}">${defs.use(icon, e.x, e.y, e.w, e.w * 1.25, false, W)}</g>`;
      const x0 = e.x - e.w / 2;
      const top = e.y - e.w * 1.2;
      return `<g data-key="${key}" data-emblem="${e.town}"><path d="M${x0.toFixed(1)} ${top.toFixed(1)}H${(x0 + e.w).toFixed(1)}V${(top + e.w * 0.7).toFixed(1)}Q${(x0 + e.w).toFixed(1)} ${(top + e.w * 1.1).toFixed(1)} ${e.x.toFixed(1)} ${(top + e.w * 1.2).toFixed(1)}Q${x0.toFixed(1)} ${(top + e.w * 1.1).toFixed(1)} ${x0.toFixed(1)} ${(top + e.w * 0.7).toFixed(1)}Z" fill="#fff" stroke="${INK}" stroke-width="${(1.4 * px).toFixed(2)}"/></g>`;
    },
    // A name, and for a river name the path its letters follow (kept in the river-paths defs).
    label(l: Label): { markup: string; path?: string } {
      const key = `label:${l.id}`;
      if (l.kind === "title") return { markup: titleMarkup(l, key) };
      if (l.kind === "compass") return { markup: compassMarkup(l, key) };
      if (l.kind === "scale") return { markup: scaleMarkup(l, key) };
      const text = escapeXml(l.caps ? l.text.toUpperCase() : l.text);
      const style = `font-size="${l.size.toFixed(1)}"${l.italic ? ' font-style="italic"' : ""}${l.spacing ? ` letter-spacing="${(l.spacing * l.size).toFixed(1)}"` : ""} stroke-width="${(l.size * 0.22).toFixed(1)}"`;
      if (l.path) {
        const id = `rl${l.id}`;
        return {
          markup: `<text data-key="${key}" data-label="${l.id}" data-kind="${l.kind}" ${style}><textPath href="#${id}">${text}</textPath></text>`,
          path: `<path id="${id}" d="M${l.path.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}"/>`,
        };
      }
      return { markup: `<text data-key="${key}" data-label="${l.id}" data-kind="${l.kind}" x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="${l.anchor}" ${style}>${text}</text>` };
    },
  };
}

// A map title: small capitals in a white box with a double rule and a diamond at each corner.
function titleMarkup(l: Label, key: string): string {
  const f = titleFrame(l);
  const s = l.size;
  const n = (v: number) => v.toFixed(1);
  const inset = s * 0.18;
  const d = s * 0.16;
  const diamonds = [
    [f.x, f.y],
    [f.x + f.w, f.y],
    [f.x, f.y + f.h],
    [f.x + f.w, f.y + f.h],
  ]
    .map(([x, y]) => `M${n(x)} ${n(y - d)}L${n(x + d)} ${n(y)}L${n(x)} ${n(y + d)}L${n(x - d)} ${n(y)}Z`)
    .join("");
  return (
    `<g data-key="${key}" data-label="${l.id}" data-kind="title">` +
    `<rect x="${n(f.x)}" y="${n(f.y)}" width="${n(f.w)}" height="${n(f.h)}" fill="#fff" stroke="${INK}" stroke-width="${n(s * 0.07)}"/>` +
    `<rect x="${n(f.x + inset)}" y="${n(f.y + inset)}" width="${n(f.w - 2 * inset)}" height="${n(f.h - 2 * inset)}" fill="none" stroke="${INK}" stroke-width="${(s * 0.025).toFixed(2)}"/>` +
    `<path d="${diamonds}" fill="${INK}" stroke="none"/>` +
    `<text x="${n(l.x)}" y="${n(l.y)}" text-anchor="middle" font-family="'IM Fell English SC', 'IM Fell English', Georgia, serif" font-size="${n(s)}" letter-spacing="${n(l.spacing * s)}" stroke="none" fill="${INK}">${escapeXml(l.caps ? l.text.toUpperCase() : l.text)}</text></g>`
  );
}

// A compass rose: eight points, each half black and half white as on engraved maps, in a
// ringed white disc, with the N above.
function compassMarkup(l: Label, key: string): string {
  const R = l.size;
  const { x: cx, y: cy } = l;
  const n = (v: number) => v.toFixed(1);
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const cardinal = i % 2 === 0;
    const len = cardinal ? R * 0.95 : R * 0.55;
    const half = cardinal ? R * 0.13 : R * 0.09;
    const tip = [cx + Math.sin(a) * len, cy - Math.cos(a) * len];
    const left = [cx - Math.cos(a) * half, cy - Math.sin(a) * half];
    const right = [cx + Math.cos(a) * half, cy + Math.sin(a) * half];
    // Ordinal points go behind the cardinal ones.
    const draw = (p: number[], fill: string) => `<path d="M${n(cx)} ${n(cy)}L${n(tip[0])} ${n(tip[1])}L${n(p[0])} ${n(p[1])}Z" fill="${fill}" stroke="${INK}" stroke-width="${(R * 0.02).toFixed(2)}" stroke-linejoin="round"/>`;
    const shape = draw(left, INK) + draw(right, "#fff");
    if (cardinal) parts.push(shape);
    else parts.unshift(shape);
  }
  return (
    `<g data-key="${key}" data-label="${l.id}" data-kind="compass">` +
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.72)}" fill="#fff" stroke="${INK}" stroke-width="${(R * 0.03).toFixed(2)}"/>` +
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.62)}" fill="none" stroke="${INK}" stroke-width="${(R * 0.012).toFixed(2)}"/>` +
    parts.join("") +
    `<text x="${n(cx)}" y="${n(cy - R * 1.05)}" text-anchor="middle" font-family="'IM Fell English SC', 'IM Fell English', Georgia, serif" font-size="${n(R * 0.34)}" stroke="none" fill="${INK}">N</text></g>`
  );
}

// Where an added settlement's name goes and how it is set: beside the drawing, sized with
// it, in the same styles as generated names (cities in spaced capitals, villages in italics).
export function addedNameLayout(s: Pick<PlacedSymbol, "role" | "x" | "y" | "w" | "h" | "name">): { x: number; y: number; size: number; caps: boolean; italic: boolean; spacing: number; box: { x: number; y: number; w: number; h: number } } {
  const size = s.w * 0.3;
  const role: string = s.role; // added drawings can be any kind, not only generated ones
  const caps = role === "capital";
  const spacing = caps ? 0.08 : 0;
  const x = s.x + s.w * 0.5 + size * 0.2;
  const y = s.y - s.h * 0.25;
  return { x, y, size, caps, italic: role === "village", spacing, box: { x, y: y - size * 0.8, w: textWidth(s.name ?? "", size, caps, spacing), h: size } };
}

function addedName(s: PlacedSymbol): string {
  const l = addedNameLayout(s);
  const text = escapeXml(l.caps ? s.name!.toUpperCase() : s.name!);
  return `<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" font-family="'IM Fell English', Georgia, serif" font-size="${l.size.toFixed(1)}"${l.italic ? ' font-style="italic"' : ""}${l.spacing ? ` letter-spacing="${(l.spacing * l.size).toFixed(1)}"` : ""} fill="${INK}" stroke="#fff" stroke-width="${(l.size * 0.22).toFixed(1)}" stroke-linejoin="round" paint-order="stroke">${text}</text>`;
}

// A scale bar: four bands, alternately black and white, with figures above and "Miles" below.
function scaleMarkup(l: Label, key: string): string {
  const span = l.span ?? 0;
  const miles = l.miles ?? 0;
  const s = l.size;
  const n = (v: number) => v.toFixed(1);
  const x0 = l.x - span / 2;
  const h = s * 0.42;
  const bands: string[] = [];
  for (let i = 0; i < 4; i++) bands.push(`<rect x="${n(x0 + (i * span) / 4)}" y="${n(l.y - h)}" width="${n(span / 4)}" height="${n(h)}" fill="${i % 2 ? "#fff" : INK}" stroke="${INK}" stroke-width="${(s * 0.06).toFixed(2)}"/>`);
  const figure = (f: number) => {
    const v = miles * f;
    return `<text x="${n(x0 + span * f)}" y="${n(l.y - h - s * 0.3)}" text-anchor="middle" font-size="${n(s * 0.85)}" stroke-width="${n(s * 0.18)}">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`;
  };
  return (
    `<g data-key="${key}" data-label="${l.id}" data-kind="scale">` +
    `<rect x="${n(x0 - s * 0.6)}" y="${n(l.y - s * 1.5)}" width="${n(span + s * 1.2)}" height="${n(s * 2.9)}" fill="#fff" stroke="none" opacity="0.85"/>` +
    bands.join("") +
    figure(0) + figure(0.5) + figure(1) +
    `<text x="${n(l.x)}" y="${n(l.y + s * 1.05)}" text-anchor="middle" font-size="${n(s)}" font-style="italic" stroke-width="${n(s * 0.2)}">${escapeXml(l.text)}</text></g>`
  );
}

// The layer each kind of item is drawn in (see renderSvg).
export function layerOf(key: string): "bridges" | "symbols" | "places" | "emblems" | "labels" | null {
  const kind = key.split(":")[0];
  return kind === "bridge" ? "bridges" : kind === "sym" || kind === "add" ? "symbols" : kind === "landmark" || kind === "town" ? "places" : kind === "emblem" ? "emblems" : kind === "label" ? "labels" : null;
}

// Every item's key in its layer, in drawing order (back to front).
export function layerOrder(m: Pick<SvgInput, "symbols" | "towns" | "labels">): Record<"bridges" | "symbols" | "places" | "emblems" | "labels", string[]> {
  return {
    bridges: m.towns?.bridges.map((b, k) => `bridge:${b.index ?? k}`) ?? [],
    symbols: m.symbols.map((s, k) => s.key ?? `sym:${k}`),
    places: [...(m.towns?.landmarks.map((l) => `landmark:${l.id}`) ?? []), ...(m.towns?.places.map((p) => `town:${p.id}`) ?? [])],
    emblems: m.labels?.emblems.map((e, k) => `emblem:${e.index ?? k}`) ?? [],
    labels: m.labels?.labels.map((l) => `label:${l.id}`) ?? [],
  };
}

// Redraw just some items (after an edit): their markup (missing for items that are gone),
// the drawings they use (to add to the SVG's <defs> if not there yet), and the paths for
// river names.
export function renderItems(m: SvgInput, keys: Iterable<string>): { items: Map<string, string>; defs: [string, string][]; paths: [string, string][] } {
  const want = new Set(keys);
  const defs = new InkDefs(m.sprites);
  const draw = itemDrawer(m, defs);
  const items = new Map<string, string>();
  const paths: [string, string][] = [];
  m.towns?.bridges.forEach((b, k) => want.has(`bridge:${b.index ?? k}`) && items.set(`bridge:${b.index ?? k}`, draw.bridge(b, k)));
  m.symbols.forEach((s, k) => {
    const key = s.key ?? `sym:${k}`;
    if (want.has(key)) items.set(key, draw.symbol(s, k));
  });
  for (const l of m.towns?.landmarks ?? []) if (want.has(`landmark:${l.id}`)) items.set(`landmark:${l.id}`, draw.landmark(l));
  for (const p of m.towns?.places ?? []) if (want.has(`town:${p.id}`)) items.set(`town:${p.id}`, draw.town(p));
  m.labels?.emblems.forEach((e, k) => want.has(`emblem:${e.index ?? k}`) && items.set(`emblem:${e.index ?? k}`, draw.emblem(e, k)));
  for (const l of m.labels?.labels ?? []) {
    const key = `label:${l.id}`;
    if (!want.has(key)) continue;
    const { markup, path } = draw.label(l);
    items.set(key, markup);
    if (path) paths.push([`rl${l.id}`, path]);
  }
  return { items, defs: defs.entries(), paths };
}

// The frame's styles, all drawn in the band between the outer and inner rules, so the map
// inside is the same size whichever is chosen.
//   classic: a thick and a thin rule, as on old engraved maps.
//   chequered: the band between the rules divided into black and white lengths, like the
//     degree bands on old charts.
//   ornate: the classic rules with a square and diamond at each corner and a diamond at the
//     middle of each side.
//   plain: one thin rule.
function frameMarkup(fr: Frame, border: Border, px: number): string {
  const n = (v: number) => v.toFixed(1);
  const rule = (r: Frame["outer"], width: number) => `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="none" stroke="${INK}" stroke-width="${n(width)}"/>`;
  const { outer: o, inner: i } = fr;
  const gap = i.x - o.x;
  if (border === "plain") return rule(i, 1.4 * px);
  if (border === "chequered") {
    const step = 42 * px;
    const cells: string[] = [];
    // Along the top and bottom, then down the sides, black on every other length.
    for (let x = i.x, k = 0; x < i.x + i.w; x += step, k++) {
      if (k % 2) continue;
      const w = Math.min(step, i.x + i.w - x);
      cells.push(`M${n(x)} ${n(o.y)}h${n(w)}v${n(gap)}h${n(-w)}Z`, `M${n(x)} ${n(i.y + i.h)}h${n(w)}v${n(gap)}h${n(-w)}Z`);
    }
    for (let y = i.y, k = 0; y < i.y + i.h; y += step, k++) {
      if (k % 2) continue;
      const h = Math.min(step, i.y + i.h - y);
      cells.push(`M${n(o.x)} ${n(y)}h${n(gap)}v${n(h)}h${n(-gap)}Z`, `M${n(i.x + i.w)} ${n(y)}h${n(gap)}v${n(h)}h${n(-gap)}Z`);
    }
    return `<path d="${cells.join("")}" fill="${INK}"/>` + rule(o, 1.6 * px) + rule(i, 1.2 * px);
  }
  const classic = rule(o, 3 * px) + rule(i, 1.2 * px);
  if (border === "classic") return classic;
  // Ornate: corner squares with a diamond inside, and a diamond at the middle of each side.
  const c = gap * 2.4;
  const diamond = (x: number, y: number, r: number) => `M${n(x)} ${n(y - r)}L${n(x + r)} ${n(y)}L${n(x)} ${n(y + r)}L${n(x - r)} ${n(y)}Z`;
  const corners = [
    [o.x, o.y],
    [o.x + o.w, o.y],
    [o.x, o.y + o.h],
    [o.x + o.w, o.y + o.h],
  ];
  const squares = corners.map(([x, y]) => `<rect x="${n(x - c / 2)}" y="${n(y - c / 2)}" width="${n(c)}" height="${n(c)}" fill="#fff" stroke="${INK}" stroke-width="${n(1.6 * px)}"/>`).join("");
  const mids = [
    [o.x + o.w / 2, o.y + gap / 2],
    [o.x + o.w / 2, o.y + o.h - gap / 2],
    [o.x + gap / 2, o.y + o.h / 2],
    [o.x + o.w - gap / 2, o.y + o.h / 2],
  ];
  const diamonds = [...corners.map(([x, y]) => diamond(x, y, c * 0.32)), ...mids.map(([x, y]) => diamond(x, y, gap * 1.1))].join("");
  return classic + squares + `<path d="${diamonds}" fill="${INK}"/>`;
}

// Sea ripples, land, lakes, rivers and roads.
function renderBase(W: number, H: number, hy: Hydrology, towns?: Settlements, coast: Coast = "ripples"): string {
  const sx = W / hy.cols;
  const sy = H / hy.rows;
  const px = W / 1600;
  const toMap = (loop: Pt[]): Pt[] => loop.map(([x, y]) => [x * sx, y * sy]);
  const parts: string[] = [];

  const seaDist = distanceFrom(hy, (i) => hy.water[i] !== WATER_SEA);
  if (coast === "stipple") {
    // A second, fine shore line just offshore, and stippled dots fading out to sea.
    const offshore = outlines(hy.cols, hy.rows, (i) => hy.water[i] !== WATER_SEA || seaDist[i] <= 1).map((l) => toMap(smoothLoop(l, 3)));
    parts.push(`<path d="${pathOf(offshore)}" fill="none" stroke="${INK}" stroke-width="${(0.9 * px).toFixed(2)}"/>`);
    parts.push(stipple(hy, sx, sy, px, (i) => (hy.water[i] === WATER_SEA ? seaDist[i] : Infinity), 7, 1.1));
  } else {
    // Ripple lines in the sea, following the coast at two distances (engraved-map style).
    for (const [d, width] of [[2, 0.9], [4.5, 0.6]] as const) {
      const loops = outlines(hy.cols, hy.rows, (i) => hy.water[i] !== WATER_SEA || seaDist[i] <= d).map((l) => toMap(smoothLoop(l, 3)));
      parts.push(`<path d="${pathOf(loops)}" fill="none" stroke="${INK}" stroke-width="${width}" stroke-opacity="0.8"/>`);
    }
  }

  // Land, with a bold coastline.
  const land = outlines(hy.cols, hy.rows, (i) => hy.water[i] !== WATER_SEA).map((l) => toMap(smoothLoop(l, 3)));
  parts.push(`<path d="${pathOf(land)}" fill="#fff" fill-rule="evenodd" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`);

  // Lakes: shore line and one ripple inside.
  const lakes = outlines(hy.cols, hy.rows, (i) => hy.water[i] === WATER_LAKE).map((l) => toMap(smoothLoop(l, 3)));
  if (lakes.length) {
    parts.push(`<path d="${pathOf(lakes)}" fill="#fff" fill-rule="evenodd" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`);
    const lakeDist = distanceFrom(hy, (i) => hy.water[i] !== WATER_LAKE);
    if (coast === "stipple") {
      parts.push(stipple(hy, sx, sy, px, (i) => (hy.water[i] === WATER_LAKE ? lakeDist[i] : Infinity), 3.5, 1.2));
    } else {
      const inner = outlines(hy.cols, hy.rows, (i) => hy.water[i] === WATER_LAKE && lakeDist[i] > 2).map((l) => toMap(smoothLoop(l, 3)));
      if (inner.length) parts.push(`<path d="${pathOf(inner)}" fill="none" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.8"/>`);
    }
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
  constructor(private sprites?: Map<string, Sprite>) {}
  private ids = new Map<string, string>();
  private symbols: [string, string][] = [];
  private ref(icon: InkSymbol): string {
    let id = this.ids.get(icon.id);
    if (!id) {
      // Named after the drawing, so an item keeps its reference when others are edited.
      id = `i-${icon.id.replace(/[^\w-]/g, "_")}`;
      this.ids.set(icon.id, id);
      this.symbols.push([id, `<symbol id="${id}" viewBox="${icon.viewBox}">${icon.body}</symbol>`]);
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
    // Pre-drawn as a picture (outline and ink together): place the picture instead.
    const sprite = this.sprites?.get(icon.id);
    if (sprite) {
      const px = sprite.padX * dw;
      const py = sprite.padY * dh;
      return `<g${mirror}><image href="${sprite.href}" data-drawing="${icon.id}" x="${f(left - px)}" y="${f(top - py)}" width="${f(dw + 2 * px)}" height="${f(dh + 2 * py)}" preserveAspectRatio="none"/></g>`;
    }
    const at = `href="#${id}" x="${f(left)}" y="${f(top)}" width="${f(dw)}" height="${f(dh)}"`;
    return `<g${mirror}><use ${at} color="#fff" stroke="#fff" stroke-width="${halo.toFixed(1)}" stroke-linejoin="round"/><use ${at} color="${INK}" stroke="none"/></g>`;
  }
  markup(): string {
    return this.symbols.length ? `<defs data-layer="drawings">${this.symbols.map(([, m]) => m).join("")}</defs>` : "";
  }
  entries(): [string, string][] {
    return this.symbols;
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
    default:
      // Any other kind (an added town, banner or landmark before its drawings load): a ringed dot.
      return g(`<circle cx="${n(x)}" cy="${n(y - h / 2)}" r="${n(Math.min(w, h) / 3)}" fill="#fff" stroke-width="1"/><circle cx="${n(x)}" cy="${n(y - h / 2)}" r="${n(Math.min(w, h) / 8)}" fill="#1a1714" stroke="none"/>`);
  }
}

// Stippled dots in water near a shore: thick at the shore, thinning out to `reach` cells away.
// `dist` gives each cell's distance from the shore (Infinity where there should be none).
// Where each dot falls is worked out from the cell's number, so the same map always gets the
// same dots. All dots go in one path (a zero-length line with round ends draws a dot), which
// keeps the drawing light even with thousands of them.
function stipple(hy: Hydrology, sx: number, sy: number, px: number, dist: (i: number) => number, reach: number, density: number): string {
  const d: string[] = [];
  const hash = (n: number) => {
    let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const n = hy.cols * hy.rows;
  for (let i = 0; i < n; i++) {
    const di = dist(i);
    if (!(di >= 1 && di <= reach)) continue;
    // Dots per cell: several at the shore, fading to none at the reach.
    const f = 1 - (di - 1) / reach;
    const count = density * f * f * 2.2;
    const c = i % hy.cols;
    const r = (i - c) / hy.cols;
    for (let k = 0; k < 3; k++) {
      if (hash(i * 7 + k) >= count - k) continue;
      const x = (c + hash(i * 13 + k * 3 + 1)) * sx;
      const y = (r + hash(i * 17 + k * 5 + 2)) * sy;
      d.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0`);
    }
  }
  return d.length ? `<path d="${d.join("")}" fill="none" stroke="${INK}" stroke-width="${(1.1 * px).toFixed(2)}" stroke-linecap="round"/>` : "";
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
  if (kind === "sym" || kind === "add") {
    const s = m.symbols.find((s, k) => (s.key ?? `sym:${k}`) === key);
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

// An item on the map as a free-standing drawing (role, anchor, box, variant, facing), for
// copy and paste. Sizes match what renderSvg draws for each kind; labels have no drawing.
export function asDrawing(m: Pick<SvgInput, "width" | "symbols" | "towns" | "labels" | "ink">, key: string): { role: string; x: number; y: number; w: number; h: number; variant: number; flip: boolean } | null {
  const d = drawingOf(m, key);
  if (!d) return null;
  const px = m.width / 1600;
  const [kind, idText] = key.split(":");
  const id = Number(idText);
  if (kind === "sym" || kind === "add") {
    const s = m.symbols.find((s, k) => (s.key ?? `sym:${k}`) === key)!;
    return { role: s.role, x: s.x, y: s.y, w: s.w, h: s.h, variant: d.variant, flip: s.flip };
  }
  if (kind === "town") {
    const p = m.towns!.places.find((p) => p.id === id)!;
    const tw = (p.tier === "capital" ? 74 : p.tier === "town" ? 56 : 40) * px * (p.size ?? 1);
    return { role: p.tier, x: p.x, y: p.y + tw * 0.12, w: tw, h: tw, variant: d.variant, flip: false };
  }
  if (kind === "landmark") {
    const l = m.towns!.landmarks.find((l) => l.id === id)!;
    const lw = 30 * px * (l.size ?? 1);
    return { role: "landmark", x: l.x, y: l.y, w: lw, h: lw, variant: d.variant, flip: false };
  }
  if (kind === "bridge") {
    const b = m.towns!.bridges.find((b, k) => (b.index ?? k) === id)!;
    const bw = 24 * px * (b.size ?? 1);
    const icon = pickSymbol(m.ink, "bridge", d.variant);
    return { role: "bridge", x: b.x, y: b.y + (icon ? (bw * icon.h) / icon.w / 2 : 0), w: bw, h: bw, variant: d.variant, flip: false };
  }
  if (kind === "emblem") {
    const e = m.labels!.emblems.find((e, k) => (e.index ?? k) === id)!;
    return { role: "emblem", x: e.x, y: e.y, w: e.w, h: e.w * 1.25, variant: d.variant, flip: false };
  }
  return null;
}

// The box a drawing actually fills on the map, for picking it with the pointer: the ink
// drawing fitted into its w by h box around its anchor (mirrored if flipped), or the plain
// box when the drawings have not loaded.
export function drawnBoxOf(d: { role: string; x: number; y: number; w: number; h: number; variant: number; flip: boolean }, ink?: InkSet): { x: number; y: number; w: number; h: number } {
  const icon = pickSymbol(ink, d.role, d.variant);
  if (!icon) return { x: d.x - d.w / 2, y: d.y - d.h, w: d.w, h: d.h };
  const k = Math.min(d.w / icon.w, d.h / icon.h);
  const dw = icon.w * k;
  const dh = icon.h * k;
  const left = d.x - icon.anchorX * dw;
  return { x: d.flip ? 2 * d.x - left - dw : left, y: d.y - icon.anchorY * dh, w: dw, h: dh };
}

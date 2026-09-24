// Light editing (spec Phase 1: "move, delete or swap a symbol; rename, move or delete a
// label"). Edits are kept as a list of changes on top of the generated map, not written
// into it, so the generator stays deterministic and every edit can be undone by dropping
// it from the list. Each item on the map has a key: "sym:12", "town:3", "landmark:1",
// "bridge:4", "emblem:0" or "label:7".
//
// Layering: symbols (mountains, hills, trees, fields) are drawn back to front, and each has
// a white outline behind it, so one drawn later hides the ink of any it overlaps. A symbol's
// place in that order is its layer: its original position unless the visitor brought it
// forward or sent it back, which is how a range of peaks or a forest edge is built up.
//
// Added symbols: any drawing from the symbol library can be placed on the map ("add:1",
// "add:2", ...). They are kept in the edits like every other change, go in front of the
// generated symbols, and can then be moved, swapped, layered or deleted the same way.

import type { Label, Labelling } from "./labels";
import { boxesOverlap, symBox, textWidth } from "./labels";
import type { GeneratedMap } from "./pipeline";
import type { Settlements } from "./settlements";
import type { PlacedSymbol } from "./symbols";

export interface AddedSymbol {
  role: string; // any symbol pack: mountain, conifer, town, landmark, ...
  x: number; // anchor (middle of the base), map pixels
  y: number;
  w: number;
  h: number;
  variant: number; // which drawing of the role, 0 to 1
  flip: boolean;
}

export interface Edits {
  moved: Record<string, [number, number]>; // key -> offset in map pixels
  deleted: string[];
  variant: Record<string, number>; // key -> which drawing (0 to 1)
  text: Record<string, string>; // label key -> new wording
  z: Record<string, number>; // symbol key -> layer (higher is in front); default is its number
  added: Record<string, AddedSymbol>; // "add:N" -> a symbol placed by the visitor
}

export const NO_EDITS: Edits = { moved: {}, deleted: [], variant: {}, text: {}, z: {}, added: {} };

// Keys of items drawn as symbols (generated or added): these can be layered.
export const isSymbolKey = (key: string | null | undefined): key is string => !!key && /^(sym|add):\d+$/.test(key);

// Generated symbols keep their order; added ones go in front, in the order they were added.
const ADDED_Z = 1e6;
const defaultZ = (key: string) => (key.startsWith("add:") ? ADDED_Z : 0) + Number(key.slice(4));

export type EditedMap = Pick<GeneratedMap, "settings" | "water"> & {
  symbols: PlacedSymbol[];
  towns: Settlements;
  labels: Labelling;
};

// The map as it looks with the edits applied. Deleted items are left out; moved ones are
// shifted; swapped ones draw a different variant; renamed labels get new wording.
export function applyEdits(m: GeneratedMap, e: Edits): EditedMap {
  const gone = new Set(e.deleted);
  const shift = (key: string) => e.moved[key] ?? [0, 0];

  const layered: { s: PlacedSymbol; z: number }[] = [];
  m.symbols.forEach((s, k) => {
    const key = `sym:${k}`;
    if (gone.has(key)) return;
    const [dx, dy] = shift(key);
    layered.push({ s: { ...s, x: s.x + dx, y: s.y + dy, variant: e.variant[key] ?? s.variant, key }, z: e.z?.[key] ?? k });
  });
  for (const [key, a] of Object.entries(e.added ?? {})) {
    if (gone.has(key)) continue;
    const [dx, dy] = shift(key);
    layered.push({ s: { ...a, role: a.role as PlacedSymbol["role"], x: a.x + dx, y: a.y + dy, variant: e.variant[key] ?? a.variant, key }, z: e.z?.[key] ?? defaultZ(key) });
  }
  // Sort is stable, so symbols without a layer change keep the generator's order.
  const symbols = layered.sort((a, b) => a.z - b.z).map((l) => l.s);

  const towns: Settlements = {
    ...m.towns,
    places: m.towns.places
      .filter((p) => !gone.has(`town:${p.id}`))
      .map((p) => {
        const [dx, dy] = shift(`town:${p.id}`);
        return { ...p, x: p.x + dx, y: p.y + dy, variant: e.variant[`town:${p.id}`] };
      }),
    landmarks: m.towns.landmarks
      .filter((l) => !gone.has(`landmark:${l.id}`))
      .map((l) => {
        const [dx, dy] = shift(`landmark:${l.id}`);
        return { ...l, x: l.x + dx, y: l.y + dy, variant: e.variant[`landmark:${l.id}`] };
      }),
    bridges: m.towns.bridges
      .map((b, k) => ({ b, k }))
      .filter(({ k }) => !gone.has(`bridge:${k}`))
      .map(({ b, k }) => {
        const [dx, dy] = shift(`bridge:${k}`);
        return { ...b, x: b.x + dx, y: b.y + dy, variant: e.variant[`bridge:${k}`], index: k };
      }),
  };

  const labels: Label[] = m.labels.labels
    .filter((l) => !gone.has(`label:${l.id}`))
    .map((l) => {
      const key = `label:${l.id}`;
      const [dx, dy] = shift(key);
      const text = e.text[key] ?? l.text;
      const w = text === l.text ? l.box.w : textWidth(text, l.size, l.caps, l.spacing);
      // Keep the anchor point where it was when the wording changes.
      const bx = l.anchor === "start" ? l.box.x : l.anchor === "end" ? l.box.x + l.box.w - w : l.box.x + (l.box.w - w) / 2;
      return {
        ...l,
        text,
        x: l.x + dx,
        y: l.y + dy,
        box: { x: bx + dx, y: l.box.y + dy, w, h: l.box.h },
        path: l.path?.map(([x, y]) => [x + dx, y + dy] as [number, number]),
      };
    });

  const emblems = m.labels.emblems
    .map((em, k) => ({ em, k }))
    .filter(({ k }) => !gone.has(`emblem:${k}`))
    .map(({ em, k }) => {
      const [dx, dy] = shift(`emblem:${k}`);
      return { ...em, x: em.x + dx, y: em.y + dy, variant: e.variant[`emblem:${k}`] ?? em.variant, index: k };
    });

  return { settings: m.settings, water: m.water, symbols, towns, labels: { ...m.labels, labels, emblems, symbols } };
}

// Edits are values: every change returns a new Edits, so undo is just the previous one.
export function move(e: Edits, key: string, dx: number, dy: number): Edits {
  const [x, y] = e.moved[key] ?? [0, 0];
  // Kept to a tenth of a pixel, so edits stay short when written into a share link.
  const r = (v: number) => Math.round(v * 10) / 10;
  return { ...e, moved: { ...e.moved, [key]: [r(x + dx), r(y + dy)] } };
}

export function remove(e: Edits, key: string): Edits {
  return e.deleted.includes(key) ? e : { ...e, deleted: [...e.deleted, key] };
}

// Swap to the next drawing of the same kind. `count` is how many drawings there are.
export function swap(e: Edits, key: string, current: number, count: number): Edits {
  if (count < 2) return e;
  const index = Math.min(count - 1, Math.floor(current * count));
  const next = ((index + 1) % count + 0.5) / count;
  return { ...e, variant: { ...e.variant, [key]: Math.round(next * 1e4) / 1e4 } };
}

export function rename(e: Edits, key: string, text: string): Edits {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return remove(e, key);
  return { ...e, text: { ...e.text, [key]: clean } };
}

export function editCount(e: Edits): number {
  return Object.keys(e.moved).length + e.deleted.length + Object.keys(e.variant).length + Object.keys(e.text).length + Object.keys(e.z ?? {}).length + Object.keys(e.added ?? {}).length;
}

// Place a new symbol. Values are rounded so they survive a share link exactly.
export function addSymbol(e: Edits, a: AddedSymbol): { edits: Edits; key: string } {
  const n = Math.max(0, ...Object.keys(e.added ?? {}).map((k) => Number(k.slice(4)))) + 1;
  const key = `add:${n}`;
  const r = (v: number, k = 10) => Math.round(v * k) / k;
  const clean: AddedSymbol = { role: a.role, x: r(a.x), y: r(a.y), w: r(a.w), h: r(a.h), variant: r(a.variant, 1e4), flip: a.flip };
  return { edits: { ...e, added: { ...e.added, [key]: clean } }, key };
}

export type LayerMove = "forward" | "backward" | "front" | "back";

// Move a symbol one step in front of (or behind) the nearest symbol it overlaps, or all the
// way to the front or back. Returns the edits unchanged when there is nothing to pass.
export function layer(m: GeneratedMap, e: Edits, key: string, how: LayerMove): Edits {
  const order = applyEdits(m, e).symbols;
  const zOf = (s: PlacedSymbol) => {
    const k = keyOf(s);
    return e.z?.[k] ?? defaultZ(k);
  };
  const i = order.findIndex((s) => keyOf(s) === key);
  if (i < 0) return e;
  let z: number | null = null;
  if (how === "front") z = i === order.length - 1 ? null : Math.floor(zOf(order[order.length - 1])) + 1;
  else if (how === "back") z = i === 0 ? null : Math.ceil(zOf(order[0])) - 1;
  else {
    const box = symBox(order[i]);
    const step = how === "forward" ? 1 : -1;
    for (let j = i + step; j >= 0 && j < order.length; j += step) {
      if (!boxesOverlap(box, symBox(order[j]))) continue;
      // Land between the overlapping symbol and its neighbour on the far side.
      const far = order[j + step];
      const zj = zOf(order[j]);
      z = far ? (zj + zOf(far)) / 2 : zj + step;
      break;
    }
  }
  if (z === null) return e;
  return { ...e, z: { ...e.z, [key]: Math.round(z * 1e6) / 1e6 } };
}

const keyOf = (s: PlacedSymbol) => s.key!;

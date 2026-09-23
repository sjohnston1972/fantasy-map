// Light editing (spec Phase 1: "move, delete or swap a symbol; rename, move or delete a
// label"). Edits are kept as a list of changes on top of the generated map, not written
// into it, so the generator stays deterministic and every edit can be undone by dropping
// it from the list. Each item on the map has a key: "sym:12", "town:3", "landmark:1",
// "bridge:4", "emblem:0" or "label:7".

import type { Label, Labelling } from "./labels";
import { textWidth } from "./labels";
import type { GeneratedMap } from "./pipeline";
import type { Settlements } from "./settlements";
import type { PlacedSymbol } from "./symbols";

export interface Edits {
  moved: Record<string, [number, number]>; // key -> offset in map pixels
  deleted: string[];
  variant: Record<string, number>; // key -> which drawing (0 to 1)
  text: Record<string, string>; // label key -> new wording
}

export const NO_EDITS: Edits = { moved: {}, deleted: [], variant: {}, text: {} };

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

  const symbols: PlacedSymbol[] = [];
  m.symbols.forEach((s, k) => {
    const key = `sym:${k}`;
    if (gone.has(key)) return;
    const [dx, dy] = shift(key);
    symbols.push({ ...s, x: s.x + dx, y: s.y + dy, variant: e.variant[key] ?? s.variant, key } as PlacedSymbol & { key: string });
  });

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
  return { ...e, moved: { ...e.moved, [key]: [x + dx, y + dy] } };
}

export function remove(e: Edits, key: string): Edits {
  return e.deleted.includes(key) ? e : { ...e, deleted: [...e.deleted, key] };
}

// Swap to the next drawing of the same kind. `count` is how many drawings there are.
export function swap(e: Edits, key: string, current: number, count: number): Edits {
  if (count < 2) return e;
  const index = Math.min(count - 1, Math.floor(current * count));
  return { ...e, variant: { ...e.variant, [key]: ((index + 1) % count + 0.5) / count } };
}

export function rename(e: Edits, key: string, text: string): Edits {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return remove(e, key);
  return { ...e, text: { ...e.text, [key]: clean } };
}

export function editCount(e: Edits): number {
  return Object.keys(e.moved).length + e.deleted.length + Object.keys(e.variant).length + Object.keys(e.text).length;
}

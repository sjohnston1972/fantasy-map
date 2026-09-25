// Picking items on the map: which item is under the pointer or inside a box, the picked set,
// and the dashed box and action bar drawn around it.

import { addedNameLayout, asDrawing, drawingOf, drawnBoxOf, frameFor } from "../gen/svg";
import { editCount, isSymbolKey } from "../gen/edits";
import { els } from "./dom";
import { state, type Hit } from "./state";

// ---- Picking with the pointer ----
// Browsers count a click as on a drawing only where there is ink, and these drawings are
// mostly gaps between strokes, so a click in the middle of a mountain or between the
// letters of a name used to miss. Instead, anything whose drawn box is under the pointer
// can be picked: the one whose ink is under the pointer if there is one, otherwise the one
// drawn on top.

export function hits(): Hit[] {
  if (state.hitList || !state.edited || !state.current) return state.hitList ?? [];
  const map = state.edited;
  const input = { width: state.current.settings.width, symbols: map.symbols, towns: map.towns, labels: map.labels, ink: state.ink };
  const list: Hit[] = [];
  const add = (key: string) => {
    const d = asDrawing(input, key);
    if (d) list.push({ key, ...drawnBoxOf(d, state.ink) });
  };
  map.towns.bridges.forEach((b, k) => add(`bridge:${b.index ?? k}`));
  map.symbols.forEach((sym, k) => {
    const b = drawnBoxOf(sym, state.ink);
    if (!sym.name) return list.push({ key: sym.key ?? `sym:${k}`, ...b });
    // An added town's name counts as part of it.
    const n = addedNameLayout(sym).box;
    const x = Math.min(b.x, n.x);
    const y = Math.min(b.y, n.y);
    list.push({ key: sym.key!, x, y, w: Math.max(b.x + b.w, n.x + n.w) - x, h: Math.max(b.y + b.h, n.y + n.h) - y });
  });
  for (const l of map.towns.landmarks) add(`landmark:${l.id}`);
  for (const p of map.towns.places) add(`town:${p.id}`);
  map.labels.emblems.forEach((em, k) => add(`emblem:${em.index ?? k}`));
  for (const l of map.labels.labels) list.push({ key: `label:${l.id}`, ...l.box });
  state.hitList = list;
  return list;
}

// An item's drawn box on the screen, from the map's own geometry. Browsers disagree about the
// boxes of SVG drawings (Firefox reports drawings placed with <use> at a fraction of their
// size), so the page never asks them.
export function screenBox(h: Hit): DOMRect {
  const { width: W, height: H } = state.current!.settings;
  const fr = frameFor(W, H);
  const r = els.map.getBoundingClientRect();
  const v = state.zoom.view;
  const sx = (x: number) => r.left + ((fr.dx + x * fr.scale - v.x) / v.w) * r.width;
  const sy = (y: number) => r.top + ((fr.dy + y * fr.scale - v.y) / v.h) * r.height;
  return new DOMRect(sx(h.x), sy(h.y), sx(h.x + h.w) - sx(h.x), sy(h.y + h.h) - sy(h.y));
}

// Keys of the items whose boxes overlap a screen rectangle, back to front.
export function keysIn(rect: DOMRect, keep: (key: string) => boolean = () => true): string[] {
  if (!state.current) return [];
  return hits()
    .filter((h) => keep(h.key))
    .filter((h) => {
      const b = screenBox(h);
      return b.left < rect.right && b.right > rect.left && b.top < rect.bottom && b.bottom > rect.top;
    })
    .map((h) => h.key);
}

// For the browser tests (e2e/): where an item is on the screen, as the page itself sees it.
(window as unknown as { inkMap: unknown }).inkMap = {
  screenBox: (key: string) => {
    const h = hits().find((x) => x.key === key);
    return h ? screenBox(h).toJSON() : null;
  },
  keys: () => hits().map((h) => h.key),
  state: () => ({ edits: state.edits, picked: state.picked, undo: state.undoStack.length, view: state.zoom.view, sprites: state.spritesShown }),
};

export function pickAt(e: PointerEvent): string | null {
  if (!state.current) return null;
  const { width: W, height: H } = state.current.settings;
  const fr = frameFor(W, H);
  const p = state.zoom.toMap(e.clientX, e.clientY);
  const x = (p.x - fr.dx) / fr.scale;
  const y = (p.y - fr.dy) / fr.scale;
  // A little slack around each box: 3 screen pixels, in map pixels.
  const slack = (3 * state.zoom.view.w) / els.map.getBoundingClientRect().width / fr.scale;
  const under = hits().filter((h) => x >= h.x - slack && x <= h.x + h.w + slack && y >= h.y - slack && y <= h.y + h.h + slack);
  if (!under.length) return null;
  // A picked item under the pointer wins, so a picked group can always be grabbed, even
  // where a name or town is drawn over it.
  const pickedUnder = under.filter((h) => state.picked.includes(h.key));
  if (pickedUnder.length) return pickedUnder[pickedUnder.length - 1].key;
  const inked = (e.target as Element).closest<SVGElement>("[data-key]")?.dataset.key;
  if (inked && under.some((h) => h.key === inked)) return inked;
  return under[under.length - 1].key;
}

// ---- Picking one or several items ----
// Click picks one item; Shift-click (or Ctrl-click) adds or removes items; Shift-drag across
// an empty part of the map (or "Select area" then drag, on touch screens) picks everything
// in the box. Moving, deleting, swapping and layering apply to all the picked items at
// once, as one undo step.

export const primary = () => state.picked[state.picked.length - 1] ?? null;

export function itemEl(key: string): SVGGraphicsElement | null {
  return els.map.querySelector<SVGGraphicsElement>(`[data-key="${key}"]`);
}

// Pick exactly this item (or nothing).
export function select(key: string | null) {
  state.picked = key ? [key] : [];
  showSelection();
}

// Add an item to the picked set, or take it out if it is already in.
export function togglePick(key: string) {
  state.picked = state.picked.includes(key) ? state.picked.filter((k) => k !== key) : [...state.picked, key];
  showSelection();
}

// Mark the picked items and set the tools to suit them.
export function showSelection() {
  for (const el of els.map.querySelectorAll(".selected")) el.classList.remove("selected");
  state.picked = state.picked.filter((key) => {
    const el = itemEl(key);
    el?.classList.add("selected");
    return !!el;
  });
  const one = state.picked.length === 1 ? state.picked[0] : null;
  // Names can be reworded, and so can the settlements added from the palette (their name);
  // the compass cannot.
  const oneLabel = one?.startsWith("label:") ? state.edited?.labels.labels.find((l) => `label:${l.id}` === one) : undefined;
  const oneAdded = one?.startsWith("add:") ? state.edited?.symbols.find((s) => s.key === one) : undefined;
  const isSettlement = !!oneAdded && ["village", "town", "capital"].includes(oneAdded.role);
  const isLabel = (!!oneLabel && oneLabel.kind !== "compass") || isSettlement;
  const swappable = state.picked.some((key) => {
    const d = state.edited ? drawingOf(state.edited, key) : null;
    return !!d && (state.ink?.[d.role]?.length ?? 0) >= 2;
  });
  els.del.disabled = !state.picked.length;
  els.smaller.disabled = els.bigger.disabled = !state.picked.length;
  placeSelBox();
  els.forward.disabled = els.backward.disabled = !state.picked.some(isSymbolKey);
  els.swap.disabled = !swappable;
  els.copy.disabled = els.cut.disabled = !state.picked.some((key) => !key.startsWith("label:"));
  els.paste.disabled = !state.clipboard.length;
  els.undo.disabled = state.undoStack.length === 0;
  els.redo.disabled = state.redoStack.length === 0;
  els.rename.hidden = !isLabel;
  if (isLabel) els.labelText.value = oneLabel?.text ?? oneAdded?.name ?? "";
  els.suggest.hidden = oneLabel?.kind !== "title";
  const n = editCount(state.edits);
  els.editHint.textContent =
    state.picked.length > 1
      ? `${state.picked.length} items picked. Drag any of them to move them all, or a corner to resize.`
      : one
        ? isLabel
          ? "Drag to move, or change the wording."
          : "Drag to move, or a corner to resize. Shift-click to pick more."
        : `Click a symbol, town or name to pick it; Shift-drag to pick several.${n ? ` ${n} ${n === 1 ? "change" : "changes"} so far.` : ""}`;
}

// Where an item stands on the map (the point its position edits move), in map pixels.
export function anchorOf(key: string): { x: number; y: number } | null {
  if (!state.edited) return null;
  const [kind, idText] = key.split(":");
  const id = Number(idText);
  if (kind === "sym" || kind === "add") return state.edited.symbols.find((s) => s.key === key) ?? null;
  if (kind === "town") return state.edited.towns.places.find((p) => p.id === id) ?? null;
  if (kind === "landmark") return state.edited.towns.landmarks.find((l) => l.id === id) ?? null;
  if (kind === "bridge") return state.edited.towns.bridges.find((b, k) => (b.index ?? k) === id) ?? null;
  if (kind === "emblem") return state.edited.labels.emblems.find((e, k) => (e.index ?? k) === id) ?? null;
  if (kind === "label") return state.edited.labels.labels.find((l) => l.id === id) ?? null;
  return null;
}

// Screen point to map pixels.
export function screenToMap(x: number, y: number): { x: number; y: number } {
  const { width: W, height: H } = state.current!.settings;
  const fr = frameFor(W, H);
  const p = state.zoom.toMap(x, y);
  return { x: (p.x - fr.dx) / fr.scale, y: (p.y - fr.dy) / fr.scale };
}

// The screen box around the picked items.
export function pickedRect(): DOMRect | null {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const set = new Set(state.picked);
  for (const h of hits()) {
    if (!set.has(h.key)) continue;
    const rect = screenBox(h);
    l = Math.min(l, rect.left);
    t = Math.min(t, rect.top);
    r = Math.max(r, rect.right);
    b = Math.max(b, rect.bottom);
  }
  return l < r ? new DOMRect(l, t, r - l, b - t) : null;
}

export function placeSelBox(rect = state.editing && !state.drag && !state.resizing ? pickedRect() : null) {
  // The bar of actions shows only while the picked items are still (not mid-gesture).
  els.selBar.hidden = !rect || !!state.resizing;
  if (!rect) {
    els.selBox.hidden = true;
    return;
  }
  const box = els.mapBox.getBoundingClientRect();
  els.selBox.hidden = false;
  // A little room around the items, so the box never sits on their ink.
  const pad = 3;
  Object.assign(els.selBox.style, { left: `${rect.left - box.left - pad}px`, top: `${rect.top - box.top - pad}px`, width: `${rect.width + 2 * pad}px`, height: `${rect.height + 2 * pad}px` });
  if (!els.selBar.hidden) {
    // Above the box (clear of its handles), or below it when there is no room above; kept
    // inside the map.
    const bw = els.selBar.offsetWidth;
    const bh = els.selBar.offsetHeight;
    const gap = 16;
    let top = rect.top - box.top - pad - gap - bh;
    if (top < 8) top = rect.bottom - box.top + pad + gap;
    const left = Math.min(Math.max(8, rect.left - box.left + rect.width / 2 - bw / 2), box.width - bw - 8);
    Object.assign(els.selBar.style, { left: `${left}px`, top: `${Math.min(top, box.height - bh - 8)}px` });
  }
}

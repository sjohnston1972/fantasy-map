// Edit history: recording a change, undo and redo, and redrawing only the items a change
// touches.

import { applyEdits, changedKeys, move, type Edits } from "../gen/edits";
import { layerOrder, renderItems } from "../gen/svg";
import { els } from "./dom";
import { paint, updateLink } from "./main";
import { itemEl, showSelection } from "./selection";
import { state } from "./state";

export function commit(next: Edits) {
  if (next === state.edits || !state.current) return;
  state.undoStack.push(state.edits);
  state.redoStack = [];
  switchTo(next);
}

// Show a different set of edits, redrawing only the items that differ.
export function switchTo(next: Edits) {
  if (!state.current) return;
  const keys = changedKeys(state.edits, next);
  state.edits = next;
  state.edited = applyEdits(state.current, state.edits);
  state.hitList = null;
  if (!patchItems(keys)) paint(state.current);
  showSelection();
  void updateLink();
}

// Redraw some items in place: replace or remove each one, adding any drawings it needs, and
// put it back at its place in its layer's drawing order. Returns false when a full redraw
// is the better choice (a very large change, or no drawing on the page yet).
const SVG_NS = "http://www.w3.org/2000/svg";
export function patchItems(keys: Set<string>): boolean {
  const svg = els.map.querySelector("svg");
  if (!svg || !state.edited || !state.current) return false;
  if (keys.size === 0) return true;
  if (keys.size > 1500) return false;
  const { width, height } = state.current.settings;
  const input = { width, height, water: state.edited.water, symbols: state.edited.symbols, towns: state.edited.towns, labels: state.edited.labels, ink: state.ink, sprites: state.spritesShown ? state.sprites : undefined };
  const { items, defs, paths } = renderItems(input, keys);
  const parse = (markup: string) => {
    const g = document.createElementNS(SVG_NS, "g");
    g.innerHTML = markup;
    return g.firstElementChild!;
  };
  // New drawings and river-name paths go into the SVG's own definitions.
  const drawings = svg.querySelector('defs[data-layer="drawings"]') ?? svg.insertBefore(document.createElementNS(SVG_NS, "defs"), svg.firstChild);
  for (const [id, markup] of defs) if (!svg.querySelector(`#${CSS.escape(id)}`)) drawings.append(parse(markup));
  const riverDefs = svg.querySelector('defs[data-layer="river-paths"]');
  for (const [id, markup] of paths) {
    const old = svg.querySelector(`#${CSS.escape(id)}`);
    if (old) old.replaceWith(parse(markup));
    else riverDefs?.append(parse(markup));
  }
  // Take the changed items out, then put each back before the next item in its layer.
  const byKey = new Map<string, Element>();
  for (const el of els.map.querySelectorAll<SVGElement>("[data-key]")) byKey.set(el.dataset.key!, el);
  for (const key of keys) {
    byKey.get(key)?.remove();
    byKey.delete(key);
  }
  const order = layerOrder(state.edited);
  for (const layer of Object.keys(order) as (keyof typeof order)[]) {
    const list = order[layer];
    const group = svg.querySelector(`g[data-layer="${layer}"]`);
    if (!group) continue;
    // Walk the layer from the front, so "the next item" is always already in place.
    let next: Element | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const key = list[i];
      const markup = keys.has(key) ? items.get(key) : undefined;
      if (markup !== undefined) {
        const el = parse(markup);
        group.insertBefore(el, next);
        byKey.set(key, el);
      }
      next = byKey.get(key) ?? next;
    }
  }
  return true;
}

// Record a change that is already showing on the page (a finished drag, a nudge, a delete),
// without rebuilding the whole drawing, which takes a noticeable moment on a busy map.
export function commitShown(next: Edits) {
  commit(next);
}

// Move the picked items by (dx, dy) map pixels. `shown` says the page already shows them
// there (at the end of a drag); otherwise they are shifted on the page here.
export function movePicked(picked: string[], dx: number, dy: number, shown: boolean) {
  const keys = [...picked, ...followers(picked)];
  if (!shown)
    for (const key of keys) {
      const el = itemEl(key);
      el?.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)}) ${el.getAttribute("transform") ?? ""}`.trim());
    }
  commitShown(keys.reduce((e, key) => move(e, key, dx, dy), state.edits));
}

// A town's name and banner go wherever the town goes, unless they are being moved
// themselves (picked along with it).
export function followers(keys: string[]): string[] {
  if (!state.edited) return [];
  const moving = new Set(keys);
  const out = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith("town:")) continue;
    const id = Number(key.slice(5));
    for (const l of state.edited.labels.labels) if (l.ref === id && !l.path && !moving.has(`label:${l.id}`)) out.add(`label:${l.id}`);
    state.edited.labels.emblems.forEach((em, k) => {
      const e = `emblem:${em.index ?? k}`;
      if (em.town === id && !moving.has(e)) out.add(e);
    });
  }
  return [...out];
}

export function initHistory() {
  els.undo.addEventListener("click", undo);
  els.redo.addEventListener("click", redo);
}

export function redo() {
  const next = state.redoStack.pop();
  if (!next || !state.current) return;
  state.undoStack.push(state.edits);
  switchTo(next);
}
export function undo() {
  const prev = state.undoStack.pop();
  if (!prev || !state.current) return;
  state.redoStack.push(state.edits);
  switchTo(prev);
}

// Apply one change to every picked item, as a single step.
export function forPicked(change: (e: Edits, key: string) => Edits, keys: string[] = state.picked) {
  const next = keys.reduce(change, state.edits);
  commit(next);
  return next;
}

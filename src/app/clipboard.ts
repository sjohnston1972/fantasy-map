// Copy, cut and paste of picked items, kept on this page.

import { addSymbol } from "../gen/edits";
import { asDrawing, frameFor } from "../gen/svg";
import { els } from "./dom";
import { deletePicked } from "./actions";
import { commit } from "./history";
import { setAreaMode } from "./gestures";
import { showSelection } from "./selection";
import { state } from "./state";

// Copies are kept on this page (not the system clipboard) as drawings placed relative to
// their middle, so a group keeps its layout. They survive generating a new map, so a
// favourite cluster can be carried to another map. Names are not copied.

export function initClipboard() {
  els.copy.addEventListener("click", copyPicked);
  els.cut.addEventListener("click", cutPicked);
  els.paste.addEventListener("click", () => pasteClipboard(true));
}

export function copyPicked(): boolean {
  if (!state.edited || !state.current) return false;
  const map = { width: state.current.settings.width, symbols: state.edited.symbols, towns: state.edited.towns, labels: state.edited.labels, ink: state.ink };
  // Keep the drawing order: generated symbols, then added ones, as drawn.
  const order = new Map(state.edited.symbols.map((s, i) => [s.key, i]));
  const keys = [...state.picked].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  const items = keys.flatMap((key) => {
    const d = asDrawing(map, key);
    return d ? [d] : [];
  });
  if (!items.length) return false;
  const cx = items.reduce((s, d) => s + d.x, 0) / items.length;
  const cy = items.reduce((s, d) => s + d.y, 0) / items.length;
  state.clipboard = items.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy }));
  els.paste.disabled = false;
  els.editHint.textContent = `Copied ${items.length} ${items.length === 1 ? "item" : "items"}. Point at the map and press Ctrl+V (or Paste) to place a copy.`;
  return true;
}

export function cutPicked() {
  if (copyPicked()) deletePicked();
}

// Paste centred on the pointer if it is over the map (else the middle of the view). The
// copies become the picked items, ready to drag into place.
export function pasteClipboard(fromButton = false) {
  if (!state.clipboard.length || !state.current) return;
  const { width: W, height: H } = state.current.settings;
  const fr = frameFor(W, H);
  const r = els.map.getBoundingClientRect();
  const over = !fromButton && state.lastPointer && state.lastPointer.x >= r.left && state.lastPointer.x <= r.right && state.lastPointer.y >= r.top && state.lastPointer.y <= r.bottom;
  const p = over ? state.zoom.toMap(state.lastPointer!.x, state.lastPointer!.y) : { x: state.zoom.view.x + state.zoom.view.w / 2, y: state.zoom.view.y + state.zoom.view.h / 2 };
  const cx = (p.x - fr.dx) / fr.scale;
  const cy = (p.y - fr.dy) / fr.scale;
  let next = state.edits;
  const keys: string[] = [];
  for (const d of state.clipboard) {
    const added = addSymbol(next, { ...d, x: d.x + cx, y: d.y + cy });
    next = added.edits;
    keys.push(added.key);
  }
  commit(next);
  state.picked = keys;
  setAreaMode(false);
  showSelection();
}

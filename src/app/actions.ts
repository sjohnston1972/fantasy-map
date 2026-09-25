// The editing buttons: edit mode on and off, Swap, Forward, Back, Delete, and rewording a
// name (with "Suggest another" for the title).

import { isSymbolKey, layer, remove, rename, swap, type LayerMove } from "../gen/edits";
import { titleOptions } from "../gen/names";
import { drawingOf } from "../gen/svg";
import { els } from "./dom";
import { commit, commitShown, forPicked } from "./history";
import { closePalette } from "./palette";
import { itemEl, primary, select } from "./selection";
import { state } from "./state";

// ---- Light editing ----
// Edit mode is switched on with a button so that, on a tablet, dragging the map scrolls
// the page until the visitor chooses to edit.

export function initActions() {
  els.editMode.addEventListener("click", () => {
    state.editing = !state.editing;
    els.editMode.setAttribute("aria-pressed", String(state.editing));
    els.editMode.textContent = state.editing ? "Finish editing" : "Edit the map";
    els.editTools.hidden = !state.editing;
    els.map.classList.toggle("editing", state.editing);
    if (!state.editing) {
      select(null);
      closePalette();
    }
    else els.map.focus({ preventScroll: true });
  });

  els.del.addEventListener("click", () => deletePicked());
  els.swap.addEventListener("click", swapSelected);
  // Shift-click goes all the way to the front or back.
  els.forward.addEventListener("click", (e) => layerSelected(e.shiftKey ? "front" : "forward"));
  els.backward.addEventListener("click", (e) => layerSelected(e.shiftKey ? "back" : "backward"));

  els.rename.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = primary();
    if (state.picked.length === 1 && key && (key.startsWith("label:") || key.startsWith("add:"))) commit(rename(state.edits, key, els.labelText.value));
    els.map.focus({ preventScroll: true });
  });

  // "Suggest another" for a picked title: the next of the usual wordings for its region.
  els.suggest.addEventListener("click", () => {
    const key = state.picked.length === 1 ? state.picked[0] : null;
    const title = key && state.edited?.labels.labels.find((l) => `label:${l.id}` === key && l.kind === "title");
    const capital = state.edited?.labels.labels.find((l) => l.kind === "capital")?.text;
    if (!key || !title || !capital) return;
    const options = titleOptions(title.culture, capital);
    commit(rename(state.edits, key, options[(options.indexOf(title.text) + 1) % options.length]));
  });
}

export function deletePicked() {
  if (!state.picked.length) return;
  const keys = state.picked;
  for (const key of keys) itemEl(key)?.remove();
  state.picked = [];
  commitShown(keys.reduce(remove, state.edits));
}

export function layerSelected(how: LayerMove) {
  const keys = state.picked.filter(isSymbolKey);
  if (!keys.length || !state.current) return;
  const map = state.current;
  // Bringing forward, the front-most goes first so the group keeps its own order.
  const order = how === "forward" || how === "front" ? [...keys].reverse() : keys;
  const next = order.reduce((e, key) => layer(map, e, key, how), state.edits);
  if (next === state.edits) {
    els.editHint.textContent = how === "forward" || how === "front" ? "Already in front of everything it touches." : "Already behind everything it touches.";
    return;
  }
  commit(next);
}

export function swapSelected() {
  if (!state.picked.length || !state.edited) return;
  const map = state.edited;
  forPicked((e, key) => {
    const d = drawingOf(map, key);
    return d ? swap(e, key, d.variant, state.ink?.[d.role]?.length ?? 0) : e;
  });
}


// The keyboard: zoom and look-around keys anywhere on the page, and the editing keys in edit
// mode.

import { isSymbolKey } from "../gen/edits";
import { deletePicked, layerSelected, swapSelected } from "./actions";
import { els } from "./dom";
import { copyPicked, cutPicked, pasteClipboard } from "./clipboard";
import { movePicked, redo, undo } from "./history";
import { closePalette } from "./palette";
import { resizeInPlace } from "./resize";
import { keysIn, primary, select, showSelection } from "./selection";
import { state } from "./state";
import { MAX_ZOOM } from "./zoom";

export function initKeys() {
  // Zoom keys work anywhere on the page except in text boxes: + and - zoom, 0 shows the whole
  // map. Arrow keys look around a zoomed map when it has focus and nothing is picked.
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
    const pan: Record<string, [number, number]> = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] };
    if (e.key === "+" || e.key === "=") state.zoom.zoomBy(1.5);
    else if (e.key === "-" || e.key === "_") state.zoom.zoomBy(1 / 1.5);
    else if (e.key === "0") state.zoom.zoomBy(1 / MAX_ZOOM);
    else if (pan[e.key] && e.target === els.map && state.zoom.level > 1.0001 && !(state.editing && state.picked.length)) state.zoom.pan(...pan[e.key]);
    else return;
    e.preventDefault();
  });

  // Keyboard: N and Shift+N step through the items, arrows nudge, S swaps, ] and [ layer
  // (Shift for all the way), Delete removes, Escape lets go, Ctrl+Z undoes, and Ctrl+C,
  // Ctrl+X and Ctrl+V copy, cut and paste.
  document.addEventListener("keydown", (e) => {
    if (!state.editing) return;
    const typing = e.target instanceof Element && !!e.target.closest("input, select, textarea");
    if (typing) return;
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "z" && e.shiftKey) redo();
      else if (k === "z") undo();
      else if (k === "y") redo();
      else if (k === "c") {
        if (!copyPicked()) return; // nothing to copy: leave the browser's own copy alone
      }
      else if (k === "x") cutPicked();
      else if (k === "v") pasteClipboard();
      else if (k === "a") pickAllSymbols();
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    const step = e.shiftKey ? 16 : 4;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key.toLowerCase() === "n") {
      const keys = [...els.map.querySelectorAll<SVGElement>("[data-key]")].map((el) => el.dataset.key!);
      if (!keys.length) return;
      const at = primary() ? keys.indexOf(primary()!) : -1;
      select(keys[(at + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]);
    } else if (e.key === "Escape") {
      if (state.placing) closePalette();
      else select(null);
    } else if (!state.picked.length) return;
    else if (e.key === "Delete" || e.key === "Backspace") deletePicked();
    else if (e.key.toLowerCase() === "s") swapSelected();
    else if (e.code === "BracketRight") layerSelected(e.shiftKey ? "front" : "forward");
    else if (e.code === "BracketLeft") layerSelected(e.shiftKey ? "back" : "backward");
    else if (nudge[e.key]) movePicked(state.picked, ...nudge[e.key], false);
    else if (e.key === "." || e.key === ">") resizeInPlace(1.15);
    else if (e.key === "," || e.key === "<") resizeInPlace(1 / 1.15);
    else return;
    e.preventDefault();
  });
}

// Ctrl+A in edit mode picks every symbol in view (not towns or names), to move or delete a
// whole patch at once.
export function pickAllSymbols() {
  state.picked = keysIn(els.map.getBoundingClientRect(), isSymbolKey);
  showSelection();
}

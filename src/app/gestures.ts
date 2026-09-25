// Pointer gestures on the map: dragging picked items, drawing a picking box, and handing
// pans, pinches, double-clicks and the wheel to the zoom (src/app/zoom.ts).

import { frameFor } from "../gen/svg";
import { els } from "./dom";
import { followers, movePicked } from "./history";
import { placeAt } from "./palette";
import { itemEl, keysIn, pickAt, placeSelBox, primary, select, showSelection, togglePick } from "./selection";
import { state } from "./state";
import { MAX_ZOOM } from "./zoom";

// ---- Dragging ----
// A pointer on an item (in edit mode) drags it, with the rest of the picked items; a
// Shift-drag on empty map (or any drag while "Select area" is on) draws a picking box;
// anywhere else a drag pans the zoomed map; a second finger turns any of them into a pinch.

export function cancelDrag() {
  if (!state.drag) return;
  for (const it of state.drag.items) {
    if (it.base) it.el.setAttribute("transform", it.base);
    else it.el.removeAttribute("transform");
  }
  state.drag = null;
}

export function cancelBox() {
  state.box?.el.remove();
  state.box = null;
}

export function initGestures() {
  els.selectArea.addEventListener("click", () => setAreaMode(!state.areaMode));

  els.map.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (document.activeElement !== els.map) els.map.focus({ preventScroll: true });
    state.lastPointer = { x: e.clientX, y: e.clientY };
    if (state.zoom.pinching || (state.drag && state.drag.pointer !== e.pointerId) || (state.box && state.box.pointer !== e.pointerId)) {
      cancelDrag();
      cancelBox();
      state.zoom.down(e);
      e.preventDefault();
      return;
    }
    if (state.editing && state.placing) {
      state.zoom.track(e);
      placeAt(e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    const hitKey = state.editing ? pickAt(e) : null;
    const el = hitKey ? itemEl(hitKey) : null;
    const adding = e.shiftKey || e.ctrlKey || e.metaKey;
    // Picking box: Shift-drag on empty map, or a drag in "Select area" mode that does not
    // start on an already picked item (those drag the group, as always).
    const onPicked = !!el && state.picked.includes(el.dataset.key!);
    if (state.editing && ((adding && !el) || (state.areaMode && !onPicked))) {
      state.zoom.track(e);
      const div = document.createElement("div");
      div.className = "pick-box";
      els.mapBox.append(div);
      state.box = { pointer: e.pointerId, x: e.clientX, y: e.clientY, add: adding, el: div };
      capture(e);
      e.preventDefault();
      return;
    }
    if (!el) {
      if (state.editing) select(null);
      if (state.zoom.down(e)) {
        els.map.classList.add("panning");
        e.preventDefault();
      }
      return;
    }
    state.zoom.track(e);
    const key = el.dataset.key!;
    if (adding) {
      togglePick(key);
      e.preventDefault();
      return;
    }
    if (!state.picked.includes(key)) select(key);
    // Screen pixels to map pixels: the zoomed view over the map's box, and the frame's slight
    // shrink inside it (the same measure picking and the selection box use, so they agree).
    const { width: W, height: H } = state.current!.settings;
    const scale = state.zoom.view.w / els.map.getBoundingClientRect().width / frameFor(W, H).scale;
    // The picked items, and the names and banners of any picked towns, move together.
    const items = [...state.picked, ...followers(state.picked)].flatMap((k) => {
      const it = itemEl(k);
      return it ? [{ key: k, el: it, base: it.getAttribute("transform") ?? "" }] : [];
    });
    state.drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY, scale, items, dx: 0, dy: 0 };
    els.selBox.hidden = true;
    els.selBar.hidden = true;
    capture(e);
    e.preventDefault();
  });

  els.map.addEventListener("pointermove", (e) => {
    state.lastPointer = { x: e.clientX, y: e.clientY };
    if (!state.drag && !state.box && state.zoom.move(e)) return;
    if (state.box && state.box.pointer === e.pointerId) {
      const r = els.mapBox.getBoundingClientRect();
      const [x0, x1] = [Math.min(state.box.x, e.clientX), Math.max(state.box.x, e.clientX)];
      const [y0, y1] = [Math.min(state.box.y, e.clientY), Math.max(state.box.y, e.clientY)];
      Object.assign(state.box.el.style, { left: `${x0 - r.left}px`, top: `${y0 - r.top}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      return;
    }
    if (!state.drag || state.drag.pointer !== e.pointerId) return;
    state.drag.dx = (e.clientX - state.drag.x) * state.drag.scale;
    state.drag.dy = (e.clientY - state.drag.y) * state.drag.scale;
    for (const it of state.drag.items) it.el.setAttribute("transform", `translate(${state.drag.dx.toFixed(1)} ${state.drag.dy.toFixed(1)}) ${it.base}`.trim());
  });

  els.map.addEventListener("pointerup", endDrag);
  els.map.addEventListener("pointercancel", endDrag);

  els.map.addEventListener("dblclick", (e) => {
    const key = primary();
    if (state.editing && state.picked.length === 1 && key?.startsWith("label:")) els.labelText.select();
    else if (!state.editing) state.zoom.zoomBy(2, state.zoom.toMap(e.clientX, e.clientY));
  });

  els.map.addEventListener("wheel", (e) => state.zoom.wheel(e), { passive: false });
  els.zoomIn.addEventListener("click", () => state.zoom.zoomBy(1.5));
  els.zoomOut.addEventListener("click", () => state.zoom.zoomBy(1 / 1.5));
  els.zoomFit.addEventListener("click", () => state.zoom.zoomBy(1 / MAX_ZOOM));
}

export function setAreaMode(on: boolean) {
  state.areaMode = on;
  els.selectArea.setAttribute("aria-pressed", String(on));
  els.map.classList.toggle("area", on);
}

function capture(e: PointerEvent) {
  try {
    els.map.setPointerCapture(e.pointerId);
  } catch {
    // The pointer has already gone; the gesture still ends on pointerup.
  }
}

const endDrag = (e: PointerEvent) => {
  state.zoom.up(e);
  if (!state.zoom.pinching) els.map.classList.remove("panning");
  if (state.box && state.box.pointer === e.pointerId) {
    const r = state.box.el.getBoundingClientRect();
    cancelBox();
    // Everything whose drawing overlaps the box is picked.
    if (r.width > 3 || r.height > 3) {
      const inside = keysIn(r);
      state.picked = [...new Set([...(e.shiftKey || e.ctrlKey || e.metaKey ? state.picked : []), ...inside])];
      showSelection();
    }
    // "Select area" is for one box: switch it off so the next drag moves what was picked.
    setAreaMode(false);
    return;
  }
  if (!state.drag || state.drag.pointer !== e.pointerId) return;
  const { items, dx, dy, scale } = state.drag;
  state.drag = null;
  // Ignore the tiny wobble of a click.
  if (Math.hypot(dx, dy) > 3 * scale) movePicked(items.map((it) => it.key), dx, dy, true);
  else for (const it of items) it.base ? it.el.setAttribute("transform", it.base) : it.el.removeAttribute("transform");
  placeSelBox();
};


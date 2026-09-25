// Resizing the picked items: by dragging a corner of the box around them, or in place with
// Smaller and Bigger.

import { move, resize } from "../gen/edits";
import { els } from "./dom";
import { commit, followers, forPicked } from "./history";
import { anchorOf, itemEl, pickedRect, placeSelBox, screenToMap } from "./selection";
import { state } from "./state";

// ---- Resizing ----
// Picked items get a dashed box with a handle on each corner. Dragging a handle resizes
// everything inside, with the opposite corner staying put, as in a drawing program. The
// Smaller and Bigger buttons (and the , and . keys) resize each item in place instead.

export function initResize() {
  els.smaller.addEventListener("click", () => resizeInPlace(1 / 1.15));
  els.bigger.addEventListener("click", () => resizeInPlace(1.15));

  for (const handle of els.selBox.querySelectorAll<HTMLElement>("[data-corner]")) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !state.picked.length) return;
      e.stopPropagation();
      e.preventDefault();
      const rect = pickedRect();
      if (!rect) return;
      const corner = handle.dataset.corner!; // nw, ne, sw or se: the corner being dragged
      const fixed = { x: corner.includes("w") ? rect.right : rect.left, y: corner.includes("n") ? rect.bottom : rect.top };
      const start = { x: corner.includes("w") ? rect.left : rect.right, y: corner.includes("n") ? rect.top : rect.bottom };
      const items = state.picked.flatMap((key) => {
        const el = itemEl(key);
        return el ? [{ key, el, base: el.getAttribute("transform") ?? "" }] : [];
      });
      state.resizing = { pointer: e.pointerId, fixed, start, rect, items, factor: 1 };
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // The pointer has already gone.
      }
    });
    handle.addEventListener("pointermove", (e) => {
      if (!state.resizing || state.resizing.pointer !== e.pointerId) return;
      const { fixed, start, rect, items } = state.resizing;
      // How far along the box's diagonal the pointer is, from the fixed corner.
      const dx = start.x - fixed.x;
      const dy = start.y - fixed.y;
      const f = Math.min(8, Math.max(0.1, ((e.clientX - fixed.x) * dx + (e.clientY - fixed.y) * dy) / (dx * dx + dy * dy)));
      state.resizing.factor = f;
      const c = screenToMap(fixed.x, fixed.y);
      for (const it of items) it.el.setAttribute("transform", `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(${f.toFixed(4)}) translate(${(-c.x).toFixed(2)} ${(-c.y).toFixed(2)}) ${it.base}`.trim());
      // The box follows, scaled about the same corner.
      const l = fixed.x + (rect.left - fixed.x) * f;
      const r = fixed.x + (rect.right - fixed.x) * f;
      const t = fixed.y + (rect.top - fixed.y) * f;
      const b = fixed.y + (rect.bottom - fixed.y) * f;
      placeSelBox(new DOMRect(Math.min(l, r), Math.min(t, b), Math.abs(r - l), Math.abs(b - t)));
    });
    const end = (e: PointerEvent) => {
      if (!state.resizing || state.resizing.pointer !== e.pointerId) return;
      const { fixed, items, factor } = state.resizing;
      state.resizing = null;
      if (Math.abs(factor - 1) < 0.01) {
        for (const it of items) it.base ? it.el.setAttribute("transform", it.base) : it.el.removeAttribute("transform");
        placeSelBox();
        return;
      }
      // Each item grows by the factor, and its standing point moves away from (or towards)
      // the fixed corner by the same factor, so the whole group scales about that corner.
      const c = screenToMap(fixed.x, fixed.y);
      let next = state.edits;
      const resized = new Set(items.map((it) => it.key));
      for (const { key } of items) {
        const a = anchorOf(key);
        next = resize(next, key, factor);
        if (!a) continue;
        const [dx, dy] = [(a.x - c.x) * (factor - 1), (a.y - c.y) * (factor - 1)];
        next = move(next, key, dx, dy);
        // A town's name and banner keep their place beside it.
        for (const f of followers([key])) if (!resized.has(f)) next = move(next, f, dx, dy);
      }
      commit(next);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
}

export function resizeInPlace(factor: number) {
  if (!state.picked.length) return;
  forPicked((e, key) => resize(e, key, factor));
}


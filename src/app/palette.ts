// The Add symbols palette: every drawing in the library by kind, and placing the chosen one
// with each click on the map.

import { addSymbol } from "../gen/edits";
import { cultureAt, Namer } from "../gen/names";
import { rng, stageSeed } from "../gen/rng";
import { frameFor } from "../gen/svg";
import { els } from "./dom";
import { commit } from "./history";
import { loadKinds } from "./ink";
import { select } from "./selection";
import { state } from "./state";

// ---- Adding symbols from the library ----
// The palette lists every drawing in the symbol packs, by kind. Pick one, then click the
// map to place it; each click places another, so a forest or a range builds up quickly.
// "Vary size and facing" gives each copy a slightly different size and a random facing, as
// a hand-inked map would have; "Mix drawings" also picks any drawing of the kind each time.

// Kinds in the order a mapmaker reaches for them, and their usual width in map pixels on a
// 1600-pixel-wide map (the generator's sizes, see src/gen/symbols.ts and svg.ts).
export const ADD_KINDS: [string, string, number][] = [
  ["mountain", "Mountains", 80],
  ["hill", "Hills", 40],
  ["conifer", "Pine trees", 13],
  ["broadleaf", "Leafy trees", 15],
  ["field", "Fields", 17],
  ["reeds", "Reeds", 12],
  ["grass", "Grass", 9],
  ["dune", "Dunes", 33],
  ["cactus", "Cactus", 8],
  ["snow", "Snow", 15],
  ["village", "Villages", 40],
  ["town", "Towns", 56],
  ["capital", "Cities", 74],
  ["landmark", "Landmarks", 30],
  ["bridge", "Bridges", 24],
  ["emblem", "Banners", 30],
];

export function initPalette() {
  els.addOpen.addEventListener("click", () => (els.palette.hidden ? openPalette() : closePalette()));
  els.palDone.addEventListener("click", closePalette);
  els.palRole.addEventListener("change", () => {
    state.placing = null;
    fillGrid();
  });

  els.palSize.addEventListener("input", () => (els.palSizeOut.value = `${els.palSize.value}%`));
}

export function openPalette() {
  if (!state.ink) {
    els.editHint.textContent = "The symbol drawings are still loading; try again in a moment.";
    return;
  }
  els.palette.hidden = false;
  els.addOpen.setAttribute("aria-expanded", "true");
  if (!els.palRole.options.length) {
    // The map's own kinds first, in the usual order, then every other kind in the library,
    // named from its sheet title.
    const core = ADD_KINDS.filter(([role]) => state.ink?.[role]?.length).map(([role, label]) => new Option(`${label} (${state.ink![role].length})`, role));
    const extra = Object.keys(state.manifest?.packs ?? {})
      .filter((role) => !ADD_KINDS.some(([r]) => r === role))
      .map((role) => [role, state.manifest?.titles?.[role] ?? role.replace(/-/g, " ")] as const)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([role, title]) => new Option(title.charAt(0).toUpperCase() + title.slice(1), role));
    els.palRole.replaceChildren(...core);
    if (extra.length) {
      const group = document.createElement("optgroup");
      group.label = "More from the library";
      group.append(...extra);
      els.palRole.append(group);
    }
  }
  fillGrid();
  els.palRole.focus();
}

export function closePalette() {
  state.placing = null;
  els.palette.hidden = true;
  els.addOpen.setAttribute("aria-expanded", "false");
  els.map.classList.remove("placing");
}

// One button per drawing of the chosen kind, showing the drawing itself.
export function fillGrid() {
  const role = els.palRole.value;
  if (!state.ink?.[role] && state.manifest?.packs[role]) {
    // A kind not loaded yet: fetch its drawings, then show them.
    els.palGrid.replaceChildren();
    els.palHint.textContent = "Loading the drawings...";
    void loadKinds([role], false).then(() => els.palRole.value === role && fillGrid());
    return;
  }
  const list = state.ink?.[role] ?? [];
  els.palGrid.replaceChildren(
    ...list.map((icon, index) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pal-item";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", "false");
      b.setAttribute("aria-label", `${role} drawing ${index + 1}`);
      // Pack drawings come from this site's own symbol library.
      b.innerHTML = `<svg viewBox="${icon.viewBox}" aria-hidden="true" color="#1a1714">${icon.body}</svg>`;
      b.addEventListener("click", () => choose(role, index));
      return b;
    }),
  );
  els.palHint.textContent = "Pick a drawing, then click the map to place it. Keep clicking to place more; press Done or Escape to stop.";
}

export function choose(role: string, index: number) {
  state.placing = state.placing?.role === role && state.placing.index === index ? null : { role, index };
  for (const [i, b] of [...els.palGrid.children].entries()) b.setAttribute("aria-selected", String(!!state.placing && i === index));
  els.map.classList.toggle("placing", !!state.placing);
  if (state.placing) els.palHint.textContent = "Now click the map where it should stand. Each click places another. (Or press Enter on the map to place one in the middle of the view.)";
}

// Place the chosen drawing with its base centred a little below the pointer, so it looks
// centred on the click.
export function placeAt(clientX: number, clientY: number) {
  if (!state.placing || !state.current || !state.ink) return;
  const list = state.ink[state.placing.role];
  if (!list?.length) return;
  // The picked drawing, unless "Mix drawings" asks for any drawing of the kind.
  const vary = els.palVary.checked;
  const index = els.palMix.checked ? Math.floor(Math.random() * list.length) : state.placing.index;
  const icon = list[index];
  const { width: W, height: H } = state.current.settings;
  const fr = frameFor(W, H);
  const p = state.zoom.toMap(clientX, clientY); // page pixels
  const mx = (p.x - fr.dx) / fr.scale; // map pixels
  const my = (p.y - fr.dy) / fr.scale;
  const base = ADD_KINDS.find(([r]) => r === state.placing!.role)?.[2] ?? 40; // other kinds: a middling size
  const w = base * (W / 1600) * (Number(els.palSize.value) / 100) * (vary ? 0.85 + Math.random() * 0.3 : 1);
  const h = (w * icon.h) / icon.w;
  const { edits: next, key } = addSymbol(state.edits, { role: state.placing.role, x: mx, y: my + h / 2, w, h, variant: (index + 0.5) / list.length, flip: vary ? Math.random() < 0.5 : false, name: settlementName(state.placing.role, mx, my) });
  commit(next);
  select(key);
}

// A name for a village, town or city placed from the palette, in the naming style of that
// part of the map (as generated places are named: Norse in the cold north, and so on).
export function settlementName(role: string, x: number, y: number): string | undefined {
  if (!state.current || !["village", "town", "capital"].includes(role)) return undefined;
  const { width: W, height: H } = state.current.settings;
  const { cols, rows } = state.current.water;
  const c = Math.min(cols - 1, Math.max(0, Math.floor((x / W) * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor((y / H) * rows)));
  const culture = cultureAt(y / H, x / W, state.current.climate.temperature[r * cols + c], 0.5);
  const count = Object.keys(state.edits.added).length;
  const taken = new Set([...state.current.labels.labels.map((l) => l.text), ...(state.edited?.symbols.flatMap((s) => (s.name ? [s.name] : [])) ?? [])]);
  const namer = new Namer(rng(stageSeed(state.current.settings.seed, `added:${count}`)));
  for (let i = 0; i < 20; i++) {
    const name = namer.place(culture);
    if (!taken.has(name)) return name;
  }
  return undefined;
}

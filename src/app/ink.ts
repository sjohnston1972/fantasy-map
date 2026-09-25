// Loading the hand-inked symbol drawings, and the pre-drawn pictures of them used on screen
// (the pictures themselves are made in sprites.ts).

import { toInkSet, type InkSymbol } from "../gen/inkset";
import type { Edits } from "../gen/edits";
import { SEA_ROLES } from "../gen/sea";
import { els } from "./dom";
import { paint } from "./main";
import { makeSprites, SPRITE_MAX_ZOOM } from "./sprites";
import { state } from "./state";

// Symbol packs load in the background (spec: "symbol packs load in the background"). The
// map is drawn at once with placeholder shapes, then redrawn with the ink symbols.
//
// The library has many more kinds of drawing than a generated map uses (ships, beasts, and
// so on, placed from Add symbols). Only the kinds the generator draws with load at the
// start; any other kind loads when a map's added symbols use it or the palette opens it.
export const CORE_KINDS = new Set(["mountain", "hill", "conifer", "broadleaf", "reeds", "dune", "cactus", "snow", "grass", "field", "village", "town", "capital", "landmark", "bridge", "emblem", ...SEA_ROLES]);

export async function loadInk() {
  try {
    state.manifest = (await (await fetch("/api/packs/manifest.json")).json()) as NonNullable<typeof state.manifest>;
    await loadKinds(Object.keys(state.manifest.packs).filter((role) => CORE_KINDS.has(role)), false);
    // Kinds this map's added symbols use (from its link, or a map opened from the gallery).
    await loadKinds(usedKinds(state.linkEdits ?? state.edits), false);
    if (state.current) paint(state.current);
    void buildSprites();
  } catch (err) {
    console.warn("Symbol packs did not load; keeping placeholder symbols.", err);
  }
}

export function usedKinds(e: Edits): string[] {
  return [...new Set(Object.values(e.added ?? {}).map((a) => a.role))];
}

// Fetch the drawings for some kinds, once each. With `repaint`, redraw the map afterwards
// if anything new arrived.
export async function loadKinds(roles: string[], repaint = true) {
  const wanted = roles.filter((role) => state.manifest?.packs[role] && !state.ink?.[role]);
  if (!wanted.length) return;
  await Promise.all(
    wanted.map((role) => {
      if (!state.loading.has(role))
        state.loading.set(
          role,
          (async () => {
            const pack = (await (await fetch(`/api/packs/${state.manifest!.packs[role]}`)).json()) as { role: string; symbols: InkSymbol[] };
            state.ink = { ...state.ink, ...toInkSet([pack]) };
          })(),
        );
      return state.loading.get(role)!;
    }),
  );
  if (repaint && state.current) paint(state.current);
  void buildSprites();
}

export const spritesWanted = () => state.sprites.size > 0 && state.zoom.level < SPRITE_MAX_ZOOM;

export async function buildSprites() {
  if (!state.ink || !state.current) return;
  const before = state.sprites.size;
  await makeSprites(state.ink, Object.keys(state.ink), state.current.settings.width, els.map.getBoundingClientRect().width, state.sprites);
  if (state.sprites.size > before && state.current) paint(state.current);
}

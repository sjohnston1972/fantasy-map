// Pre-drawn symbols for the map on screen. A busy map places thousands of detailed line
// drawings (a dense forest alone can be 4,000 trees, each drawn twice: its white outline and
// its ink). Redrawing all those lines is what makes zooming and panning slow. Instead, each
// distinct drawing is drawn once, outline and ink together, into a small picture, and the
// map on screen places those pictures. Close in (past SPRITE_MAX_ZOOM) the page switches back
// to the line drawings, so the ink stays sharp; saved files always use the line drawings.

import type { InkSet, InkSymbol } from "../gen/inkset";
import type { Sprite } from "../gen/svg";

// Above this zoom the true line drawings are used (few symbols are in view that close).
export const SPRITE_MAX_ZOOM = 3;

// Usual width of each kind on a 1600-pixel map, to size its pictures and outlines (the same
// sizes the generator and the palette use).
const TYPICAL_WIDTH: Record<string, number> = { mountain: 80, hill: 40, conifer: 18, broadleaf: 21, reeds: 12, dune: 33, cactus: 8, snow: 15, grass: 9, field: 17, village: 40, town: 56, capital: 74, landmark: 30, bridge: 24, emblem: 30 };

// Draw every drawing of the given kinds into a picture, sized for the map as shown at
// SPRITE_MAX_ZOOM on this screen. `mapPx` is the map's width in map pixels and `screenPx`
// the width it is shown at (in screen pixels, before zoom).
export async function makeSprites(ink: InkSet, roles: string[], mapPx: number, screenPx: number, done: Map<string, Sprite>): Promise<Map<string, Sprite>> {
  const px = mapPx / 1600;
  const screenPerMap = (screenPx / mapPx) * SPRITE_MAX_ZOOM * (window.devicePixelRatio || 1);
  const jobs: Promise<void>[] = [];
  for (const role of roles) {
    const typical = (TYPICAL_WIDTH[role] ?? 40) * px;
    for (const icon of ink[role] ?? []) {
      if (done.has(icon.id)) continue;
      jobs.push(
        drawSprite(icon, typical, screenPerMap, px)
          .then((s) => void done.set(icon.id, s))
          .catch(() => undefined), // leave that drawing as lines
      );
      // A few at a time, so the page stays responsive while they are made.
      if (jobs.length >= 8) await Promise.all(jobs.splice(0));
    }
  }
  await Promise.all(jobs);
  return done;
}

async function drawSprite(icon: InkSymbol, typicalWidth: number, screenPerMap: number, px: number): Promise<Sprite> {
  const [minX, minY, vbW, vbH] = icon.viewBox.split(/[\s,]+/).map(Number);
  // The white outline, as the line drawings are given it (see InkDefs.use in src/gen/svg.ts),
  // for a symbol of the usual size: 1.3 map pixels wide.
  const k = typicalWidth / icon.w;
  const halo = (1.3 * px) / (0.1 * k);
  // Room around the drawing for the outline, in the drawing's own units.
  const pad = (halo * 0.1 * vbW) / icon.w;
  const vb = [minX - pad, minY - pad, vbW + 2 * pad, vbH + 2 * pad];
  const width = Math.max(24, Math.min(320, Math.round(typicalWidth * screenPerMap * (vb[2] / vbW))));
  const height = Math.max(1, Math.round((width * vb[3]) / vb[2]));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" width="${width}" height="${height}">` +
    `<g color="#fff" stroke="#fff" stroke-width="${halo.toFixed(2)}" stroke-linejoin="round">${icon.body}</g>` +
    `<g color="#1a1714" stroke="none">${icon.body}</g></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("no picture");
    return { href: URL.createObjectURL(blob), padX: pad / vbW, padY: pad / vbH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

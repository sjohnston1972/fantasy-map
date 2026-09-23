// The hand-inked symbols the map can draw with, grouped by role (spec milestone 7: "Real
// ink symbols replace the placeholders"). Loaded from the symbol packs by the page, or
// from the library by scripts. Without them, the renderer falls back to placeholders.

export interface InkSymbol {
  id: string;
  w: number; // drawing size in its own units
  h: number;
  anchorX: number; // 0 to 1: where it meets the ground
  anchorY: number;
  facing: string;
  viewBox: string;
  body: string; // SVG drawing without the outer <svg>; ink uses currentColor
}

export type InkSet = Record<string, InkSymbol[]>;

// Pick one drawing for a placed symbol. `variant` is the placed symbol's own random number
// (0 to 1), so the same seed and the same pack always pick the same drawing.
export function pickSymbol(set: InkSet | undefined, role: string, variant: number): InkSymbol | undefined {
  const list = set?.[role];
  if (!list?.length) return undefined;
  return list[Math.min(list.length - 1, Math.floor(variant * list.length))];
}

// Pack drawings are black; switch their ink to currentColor so one drawing can be used both
// for the white knockout behind it and for the black ink on top.
export function toInkSet(packs: { role: string; symbols: InkSymbol[] }[]): InkSet {
  const set: InkSet = {};
  for (const p of packs) set[p.role] = p.symbols.map((s) => ({ ...s, body: s.body.replace(/fill="#000(000)?"/g, 'fill="currentColor"') }));
  return set;
}

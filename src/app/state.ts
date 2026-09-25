// What the map page's modules share, in one object, so a module can change a value the others
// read without reassigning their variables.

import type { GeneratedMap } from "../gen/pipeline";
import type { InkSet } from "../gen/inkset";
import { NO_EDITS, type AddedSymbol, type EditedMap, type Edits } from "../gen/edits";
import { DEFAULT_SETTINGS, type MapSettings } from "../gen/settings";
import type { Sprite } from "../gen/svg";
import type { MapZoom } from "./zoom";

// An item's drawn box on the map, for picking (see selection.ts).
export interface Hit {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// An item being dragged or resized: its element and the transform it had before.
export interface Moving {
  key: string;
  el: SVGGraphicsElement;
  base: string;
}

export const state = {
  settings: DEFAULT_SETTINGS as MapSettings,
  current: null as GeneratedMap | null,
  ink: undefined as InkSet | undefined, // hand-inked symbols, once the packs have loaded
  // Light editing: the changes made on top of the generated map, the earlier versions of
  // those changes (for undo), and the item currently picked.
  edits: NO_EDITS as Edits,
  undoStack: [] as Edits[],
  redoStack: [] as Edits[], // undone changes, until a new change is made
  edited: null as EditedMap | null,
  picked: [] as string[], // keys of the picked items; the last is the one acted on alone
  editing: false,
  placing: null as { role: string; index: number } | null, // the palette drawing being placed
  hitList: null as Hit[] | null, // in drawing order, back to front; rebuilt after changes
  drag: null as { pointer: number; x: number; y: number; scale: number; items: Moving[]; dx: number; dy: number } | null,
  box: null as { pointer: number; x: number; y: number; add: boolean; el: HTMLElement } | null,
  resizing: null as { pointer: number; fixed: { x: number; y: number }; start: { x: number; y: number }; rect: DOMRect; items: Moving[]; factor: number } | null,
  areaMode: false,
  confirmPublish: false, // Publish has been pressed once and asks to be pressed again
  clipboard: [] as AddedSymbol[],
  lastPointer: null as { x: number; y: number } | null,
  // Edits carried by the link, applied to the first map drawn.
  linkEdits: null as Edits | null,
  manifest: null as { packs: Record<string, string>; titles?: Record<string, string> } | null,
  loading: new Map<string, Promise<void>>(),
  // Pictures of drawings for the map on screen (see sprites.ts), and whether the map now
  // shown uses them. Saved files and thumbnails always use the line drawings.
  sprites: new Map<string, Sprite>(),
  spritesShown: false,
  // Zoom and pan (src/app/zoom.ts), set up by main.ts when the page starts.
  zoom: undefined as unknown as MapZoom,
};

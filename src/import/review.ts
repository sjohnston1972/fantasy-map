// Review state: the split result after the user's corrections (spec section 3, step 3).
// Every edit returns a new state and leaves the old one untouched, which makes undo a
// matter of keeping the previous states.

import type { Box, Facing, IconFlag, Ink, SplitResult } from "./split";

// Spec 6: tags set once per row and inherited by every icon in it.
export const SCALES = ["region", "world", "town", "dungeon"] as const;
export type Scale = (typeof SCALES)[number];
export type Kind = "point" | "pattern";

export interface RowTags {
  category: string | null; // null means "use the title read by OCR"
  subtype: string;
  scales: Scale[];
  kind: Kind;
}

export interface IconTags {
  category: string;
  subtype: string;
  scales: Scale[];
  kind: Kind;
  facing: Facing;
}

export const DEFAULT_ROW_TAGS: RowTags = { category: null, subtype: "", scales: ["region"], kind: "point" };

export interface ReviewIcon extends Box {
  key: number; // stable handle for selection; survives renumbering
  row: number; // 1-based
  col: number; // 1-based, left to right
  anchorX: number;
  anchorY: number;
  flags: IconFlag[];
  extras: Box[]; // nearby marks left out of the box (possible split)
  autoFacing: Facing; // guessed from the ink
  overrides: Partial<IconTags>; // tags set on this icon alone, replacing the row's
  status?: IconStatus; // missing means draft
  savedId?: string; // the id it was stored under; kept even if its column number changes
}

export type IconStatus = "draft" | "approved" | "rejected";

// Approved and rejected icons are stored on the server and can no longer be edited.
export function isLocked(i: { status?: IconStatus }): boolean {
  return i.status === "approved" || i.status === "rejected";
}

export interface ReviewRow {
  index: number;
  title: Box | null;
  tags: RowTags;
  icons: ReviewIcon[];
}

export interface Review {
  width: number;
  height: number;
  rows: ReviewRow[];
  nextKey: number;
}

const MIN_SIZE = 4;

export function fromSplit(r: SplitResult, ink: Ink): Review {
  let key = 1;
  return {
    width: r.width,
    height: r.height,
    rows: r.rows.map((row) => ({
      index: row.index,
      title: row.title,
      tags: { ...DEFAULT_ROW_TAGS },
      icons: row.icons.map((i) => ({
        key: key++,
        row: i.row,
        col: i.col,
        x: i.x,
        y: i.y,
        w: i.w,
        h: i.h,
        anchorX: i.anchorX,
        anchorY: i.anchorY,
        flags: [...i.flags],
        extras: [...i.extras],
        autoFacing: ink.facing(i),
        overrides: {},
      })),
    })),
    nextKey: key,
  };
}

export function allIcons(r: Review): ReviewIcon[] {
  return r.rows.flatMap((row) => row.icons);
}

export function findIcon(r: Review, key: number): ReviewIcon | undefined {
  return allIcons(r).find((i) => i.key === key);
}

export function deleteIcons(r: Review, keys: number[]): Review {
  const drop = new Set(keys.filter((k) => !isLocked(findIcon(r, k) ?? {})));
  if (!drop.size) return r;
  return withRows(r, (row) => ({ ...row, icons: row.icons.filter((i) => !drop.has(i.key)) }));
}

// Merge two or more boxes in the same row into one box covering all of them.
export function mergeIcons(r: Review, ink: Ink, keys: number[]): Review {
  const icons = keys.map((k) => findIcon(r, k)).filter((i): i is ReviewIcon => !!i);
  if (icons.length < 2 || new Set(icons.map((i) => i.row)).size !== 1 || icons.some(isLocked)) return r;
  const box = union(icons);
  const merged = makeIcon(r.nextKey, icons[0].row, box, ink, icons.flatMap((i) => i.extras).filter((e) => !inside(e, box)));
  const drop = new Set(keys);
  return {
    ...withRows(r, (row) =>
      row.index === merged.row ? { ...row, icons: [...row.icons.filter((i) => !drop.has(i.key)), merged] } : row,
    ),
    nextKey: r.nextKey + 1,
  };
}

// Split one box at a vertical line. Each side shrinks to its own ink plus padding;
// a side with no ink means the line missed the icon, and nothing changes.
export function splitIcon(r: Review, ink: Ink, key: number, atX: number): Review {
  const icon = findIcon(r, key);
  if (!icon || isLocked(icon) || atX <= icon.x || atX >= icon.x + icon.w) return r;
  const left = ink.inkWithin({ x: icon.x, y: icon.y, w: atX - icon.x, h: icon.h });
  const right = ink.inkWithin({ x: atX, y: icon.y, w: icon.x + icon.w - atX, h: icon.h });
  if (!left || !right) return r;
  const a = makeIcon(r.nextKey, icon.row, clampBox(pad(left, ink.pad), ink), ink, []);
  const b = makeIcon(r.nextKey + 1, icon.row, clampBox(pad(right, ink.pad), ink), ink, []);
  return {
    ...withRows(r, (row) =>
      row.index === icon.row ? { ...row, icons: [...row.icons.filter((i) => i.key !== key), a, b] } : row,
    ),
    nextKey: r.nextKey + 2,
  };
}

// Set a box to an exact rectangle (from dragging its edges). The anchor follows the ink.
export function resizeIcon(r: Review, ink: Ink, key: number, box: Box): Review {
  const icon = findIcon(r, key);
  if (!icon || isLocked(icon)) return r;
  const b = clampBox(normalise(box), ink);
  const updated: ReviewIcon = {
    ...icon,
    ...b,
    ...anchorFor(ink, b),
    autoFacing: ink.facing(b),
    flags: [],
    extras: icon.extras.filter((e) => !inside(e, b)),
  };
  return replaceIcon(r, updated);
}

// Grow a box to take in the nearby marks it left out, or dismiss them.
export function includeExtras(r: Review, ink: Ink, key: number): Review {
  const icon = findIcon(r, key);
  if (!icon || isLocked(icon) || !icon.extras.length) return r;
  return resizeIcon(r, ink, key, union([icon, ...icon.extras]));
}

export function dismissExtras(r: Review, key: number): Review {
  const icon = findIcon(r, key);
  if (!icon || isLocked(icon)) return r;
  return replaceIcon(r, { ...icon, extras: [], flags: icon.flags.filter((f) => f !== "possible-split") });
}

export function setRowTags(r: Review, rowIndex: number, patch: Partial<RowTags>): Review {
  return withRows(r, (row) => (row.index === rowIndex ? { ...row, tags: { ...row.tags, ...patch } } : row));
}

// Set tags on one icon only. Setting a field back to the row's value removes the override.
export function setIconTags(r: Review, key: number, patch: Partial<IconTags>, ocrTitle = ""): Review {
  const icon = findIcon(r, key);
  const row = icon && r.rows.find((x) => x.index === icon.row);
  if (!icon || !row || isLocked(icon)) return r;
  const inherited = inheritedTags(row, icon, ocrTitle);
  const overrides: Partial<IconTags> = { ...icon.overrides };
  for (const [k, v] of Object.entries(patch) as [keyof IconTags, IconTags[keyof IconTags]][]) {
    if (same(v, inherited[k])) delete overrides[k];
    else (overrides as Record<string, unknown>)[k] = v;
  }
  return replaceIcon(r, { ...icon, overrides });
}

export function clearIconTag(r: Review, key: number, field: keyof IconTags): Review {
  const icon = findIcon(r, key);
  if (!icon || isLocked(icon) || !(field in icon.overrides)) return r;
  const overrides = { ...icon.overrides };
  delete overrides[field];
  return replaceIcon(r, { ...icon, overrides });
}

// What an icon gets from its row (and its own facing guess), before any override.
export function inheritedTags(row: ReviewRow, icon: ReviewIcon, ocrTitle = ""): IconTags {
  return {
    category: row.tags.category ?? ocrTitle,
    subtype: row.tags.subtype,
    scales: row.tags.scales,
    kind: row.tags.kind,
    facing: icon.autoFacing,
  };
}

// The tags that will be stored for an icon: inherited, then its overrides on top.
export function iconTags(row: ReviewRow, icon: ReviewIcon, ocrTitle = ""): IconTags {
  return { ...inheritedTags(row, icon, ocrTitle), ...icon.overrides };
}

function same(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x) => b.includes(x)) : a === b;
}

// Record that an icon has been stored under an id. Approved or rejected icons are
// locked, and their tags are frozen at the values that were stored, so later changes to
// the row's tags do not appear to change what is in the catalogue.
export function markSaved(r: Review, key: number, savedId: string, status: IconStatus, tags: IconTags): Review {
  const icon = findIcon(r, key);
  if (!icon) return r;
  const overrides = isLocked({ status }) ? { ...tags } : icon.overrides;
  return replaceIcon(r, { ...icon, savedId, status, overrides });
}

// The catalogue id for an icon (spec 4.6: <sheetId>-r<row>-c<col>). An icon keeps the id
// it was stored under; a new icon whose natural id is already taken by a stored one gets
// a letter on the end (c3b) so the two never collide.
export function iconName(r: Review, sheetId: string, icon: ReviewIcon): string {
  if (icon.savedId) return icon.savedId;
  const taken = new Set(allIcons(r).filter((i) => i.savedId && i.key !== icon.key).map((i) => i.savedId));
  const base = `${sheetId}-r${icon.row}-c${icon.col}`;
  if (!taken.has(base)) return base;
  for (const letter of "bcdefghijklmnopqrstuvwxyz") if (!taken.has(base + letter)) return base + letter;
  return base + "z";
}

// Arrow-key movement: left and right within a row, up and down to the nearest box
// horizontally in the next row that has any.
export function neighbour(r: Review, key: number, dir: "left" | "right" | "up" | "down"): number | undefined {
  const icon = findIcon(r, key);
  if (!icon) return;
  const rowIdx = r.rows.findIndex((row) => row.index === icon.row);
  const row = r.rows[rowIdx];
  const pos = row.icons.findIndex((i) => i.key === key);
  if (dir === "left") return row.icons[pos - 1]?.key;
  if (dir === "right") return row.icons[pos + 1]?.key;
  const step = dir === "up" ? -1 : 1;
  const cx = icon.x + icon.w / 2;
  for (let j = rowIdx + step; j >= 0 && j < r.rows.length; j += step) {
    const icons = r.rows[j].icons;
    if (!icons.length) continue;
    return icons.reduce((best, i) => (Math.abs(i.x + i.w / 2 - cx) < Math.abs(best.x + best.w / 2 - cx) ? i : best)).key;
  }
}

function makeIcon(key: number, row: number, box: Box, ink: Ink, extras: Box[]): ReviewIcon {
  return { key, row, col: 0, ...box, ...anchorFor(ink, box), flags: [], extras, autoFacing: ink.facing(box), overrides: {} };
}

// Anchor at the bottom centre of the ink inside the box, as fractions of the box.
function anchorFor(ink: Ink, b: Box): { anchorX: number; anchorY: number } {
  const i = ink.inkWithin(b);
  if (!i) return { anchorX: 0.5, anchorY: 1 };
  return { anchorX: (i.x + i.w / 2 - b.x) / b.w, anchorY: (i.y + i.h - b.y) / b.h };
}

function replaceIcon(r: Review, icon: ReviewIcon): Review {
  return withRows(r, (row) => ({ ...row, icons: row.icons.map((i) => (i.key === icon.key ? icon : i)) }));
}

// Apply a change to every row, then keep each row's icons in left-to-right order
// with columns numbered from 1.
function withRows(r: Review, fn: (row: ReviewRow) => ReviewRow): Review {
  return {
    ...r,
    rows: r.rows.map((row) => {
      const next = fn(row);
      if (next === row) return row;
      const icons = [...next.icons].sort((a, b) => a.x - b.x).map((i, n) => (i.col === n + 1 ? i : { ...i, col: n + 1 }));
      return { ...next, icons };
    }),
  };
}

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

function inside(a: Box, b: Box): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

function pad(b: Box, p: number): Box {
  return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p };
}

function normalise(b: Box): Box {
  const x = Math.round(Math.min(b.x, b.x + b.w));
  const y = Math.round(Math.min(b.y, b.y + b.h));
  return { x, y, w: Math.max(MIN_SIZE, Math.round(Math.abs(b.w))), h: Math.max(MIN_SIZE, Math.round(Math.abs(b.h))) };
}

function clampBox(b: Box, ink: Ink): Box {
  const x = Math.max(0, Math.min(b.x, ink.width - MIN_SIZE));
  const y = Math.max(0, Math.min(b.y, ink.height - MIN_SIZE));
  return { x, y, w: Math.min(b.w, ink.width - x), h: Math.min(b.h, ink.height - y) };
}

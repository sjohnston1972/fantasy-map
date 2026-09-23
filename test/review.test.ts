import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeInk, split } from "../src/import/split";
import {
  allIcons,
  deleteIcons,
  dismissExtras,
  findIcon,
  fromSplit,
  includeExtras,
  mergeIcons,
  neighbour,
  resizeIcon,
  setTitleText,
  splitIcon,
} from "../src/import/review";

const img = PNG.sync.read(readFileSync("example artifacts/desert.png"));
const ink = makeInk(img, DEFAULT_SETTINGS);
const start = fromSplit(split(img));
const row = (r: typeof start, n: number) => r.rows[n - 1];

describe("review edits on desert.png", () => {
  it("starts with 88 icons, each with a unique key", () => {
    const keys = allIcons(start).map((i) => i.key);
    expect(keys).toHaveLength(88);
    expect(new Set(keys).size).toBe(88);
  });

  it("deletes a box and renumbers the row", () => {
    const [a] = row(start, 1).icons;
    const r = deleteIcons(start, [a.key]);
    expect(row(r, 1).icons.map((i) => i.col)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(findIcon(r, a.key)).toBeUndefined();
    expect(allIcons(start)).toHaveLength(88); // the original is untouched, so undo works
  });

  it("merges two neighbours into one box covering both", () => {
    const [a, b] = row(start, 2).icons;
    const r = mergeIcons(start, ink, [a.key, b.key]);
    const merged = row(r, 2).icons[0];
    expect(row(r, 2).icons).toHaveLength(7);
    expect(merged.x).toBe(Math.min(a.x, b.x));
    expect(merged.x + merged.w).toBe(Math.max(a.x + a.w, b.x + b.w));
    expect(merged.flags).toEqual([]);
  });

  it("refuses to merge boxes from different rows", () => {
    const a = row(start, 1).icons[0];
    const b = row(start, 2).icons[0];
    expect(mergeIcons(start, ink, [a.key, b.key])).toBe(start);
  });

  it("splitting a merged box at the gap gives back the two icons", () => {
    const [a, b] = row(start, 2).icons;
    const merged = mergeIcons(start, ink, [a.key, b.key]);
    const m = row(merged, 2).icons[0];
    const r = splitIcon(merged, ink, m.key, Math.round((a.x + a.w + b.x) / 2));
    const [l, rt] = row(r, 2).icons;
    expect(row(r, 2).icons).toHaveLength(8);
    expect([l.x, l.y, l.w, l.h]).toEqual([a.x, a.y, a.w, a.h]);
    expect([rt.x, rt.y, rt.w, rt.h]).toEqual([b.x, b.y, b.w, b.h]);
  });

  it("ignores a split line that misses the ink", () => {
    const a = row(start, 1).icons[0];
    expect(splitIcon(start, ink, a.key, a.x + 1)).toBe(start);
  });

  it("resizes a box and moves the anchor to the ink's bottom centre", () => {
    const a = row(start, 3).icons[0];
    const r = resizeIcon(start, ink, a.key, { x: a.x - 10, y: a.y - 10, w: a.w + 20, h: a.h + 20 });
    const b = findIcon(r, a.key)!;
    expect([b.x, b.y, b.w, b.h]).toEqual([a.x - 10, a.y - 10, a.w + 20, a.h + 20]);
    const inkBottom = b.y + b.anchorY * b.h;
    expect(Math.abs(inkBottom - (a.y + a.anchorY * a.h))).toBeLessThan(0.5);
  });

  it("keeps a resized box inside the sheet", () => {
    const a = row(start, 1).icons[0];
    const b = findIcon(resizeIcon(start, ink, a.key, { x: -50, y: a.y, w: 100, h: a.h }), a.key)!;
    expect(b.x).toBe(0);
  });

  it("stores an edited row title", () => {
    const r = setTitleText(start, 4, "oasis");
    expect(row(r, 4).titleText).toBe("oasis");
    expect(row(start, 4).titleText).toBe("");
  });

  it("moves between boxes with the arrow keys", () => {
    const first = row(start, 1).icons[0];
    expect(neighbour(start, first.key, "right")).toBe(row(start, 1).icons[1].key);
    expect(neighbour(start, first.key, "left")).toBeUndefined();
    expect(neighbour(start, first.key, "down")).toBe(row(start, 2).icons[0].key);
    expect(neighbour(start, first.key, "up")).toBeUndefined();
  });
});

describe("nearby marks left out of a box", () => {
  const extra = { x: 0, y: 0, w: 5, h: 5 };
  const a = row(start, 1).icons[0];
  const withExtra = { ...start, rows: start.rows.map((r, i) => (i === 0 ? { ...r, icons: [{ ...a, extras: [extra], flags: ["possible-split" as const] }, ...r.icons.slice(1)] } : r)) };

  it("can be included, growing the box to cover them", () => {
    const b = findIcon(includeExtras(withExtra, ink, a.key), a.key)!;
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.extras).toEqual([]);
  });

  it("can be dismissed", () => {
    const b = findIcon(dismissExtras(withExtra, a.key), a.key)!;
    expect(b.extras).toEqual([]);
    expect(b.flags).toEqual([]);
  });
});

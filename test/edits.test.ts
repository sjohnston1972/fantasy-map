import { describe, expect, it } from "vitest";
import { pngSize, toBase64 } from "../src/app/export";
import { applyEdits, editCount, layer, move, NO_EDITS, remove, rename, swap, type EditedMap } from "../src/gen/edits";
import { boxesOverlap, symBox } from "../src/gen/labels";
import { toInkSet } from "../src/gen/inkset";
import { generate } from "../src/gen/pipeline";
import { DEFAULT_SETTINGS } from "../src/gen/settings";
import { Resvg } from "@resvg/resvg-js";
import { drawingOf, frameFor, renderSvg } from "../src/gen/svg";

const map = generate({ ...DEFAULT_SETTINGS, seed: 482913 });
const drawing = (id: string) => ({ id, w: 40, h: 30, anchorX: 0.5, anchorY: 1, facing: "none", viewBox: "0 0 40 30", body: '<path fill="#000" d="M0 0h40v30z"/>' });
const ink = toInkSet(
  ["mountain", "hill", "conifer", "broadleaf", "capital", "town", "village", "emblem"].map((role) => ({ role, symbols: [drawing(`${role}1`), drawing(`${role}2`), drawing(`${role}3`)] })),
);
const svgOf = (m: EditedMap, fontCss?: string) =>
  renderSvg({ width: m.settings.width, height: m.settings.height, water: m.water, symbols: m.symbols, towns: m.towns, labels: m.labels, ink, fontCss });
// The markup of one item, found by its key.
const item = (svg: string, key: string) => svg.match(new RegExp(`<(g|text) data-key="${key}"[^>]*>.*?</\\1>`))?.[0];

describe("light editing (spec: move, delete or swap a symbol; rename, move or delete a label)", () => {
  const plain = svgOf(applyEdits(map, NO_EDITS));

  it("gives every symbol, settlement and label a key", () => {
    expect(item(plain, "sym:0")).toBeTruthy();
    expect(item(plain, `town:${map.towns.places[0].id}`)).toBeTruthy();
    expect(item(plain, `label:${map.labels.labels[0].id}`)).toBeTruthy();
  });

  it("with no edits, draws the same map as before editing existed", () => {
    const direct = renderSvg({ width: map.settings.width, height: map.settings.height, water: map.water, symbols: map.symbols, towns: map.towns, labels: map.labels, ink });
    expect(plain).toBe(direct);
  });

  it("moves a symbol", () => {
    const e = move(move(NO_EDITS, "sym:3", 10, 0), "sym:3", 5, -20);
    expect(e.moved["sym:3"]).toEqual([15, -20]);
    const m = applyEdits(map, e);
    expect(m.symbols[3].x).toBeCloseTo(map.symbols[3].x + 15);
    expect(m.symbols[3].y).toBeCloseTo(map.symbols[3].y - 20);
    expect(item(svgOf(m), "sym:3")).not.toBe(item(plain, "sym:3"));
  });

  it("deletes a symbol and keeps the other keys stable", () => {
    const m = applyEdits(map, remove(NO_EDITS, "sym:0"));
    expect(m.symbols.length).toBe(map.symbols.length - 1);
    const svg = svgOf(m);
    expect(item(svg, "sym:0")).toBeUndefined();
    expect(item(svg, "sym:1")).toBe(item(plain, "sym:1"));
  });

  it("swaps a symbol to the next drawing of its kind, and round again", () => {
    const k = map.symbols.findIndex((s) => s.role === "mountain");
    const key = `sym:${k}`;
    let e = NO_EDITS;
    const seen = new Set<string>();
    for (let n = 0; n < 3; n++) {
      const m = applyEdits(map, e);
      const d = drawingOf(m, key)!;
      expect(d.role).toBe("mountain");
      seen.add(item(svgOf(m), key)!.match(/href="#([^"]+)"/)![1]);
      e = swap(e, key, d.variant, ink.mountain!.length);
    }
    expect(seen.size).toBe(3);
  });

  it("swaps a settlement's drawing", () => {
    const p = map.towns.places[0];
    const key = `town:${p.id}`;
    const d = drawingOf(applyEdits(map, NO_EDITS), key)!;
    expect(d.role).toBe(p.tier);
    const after = svgOf(applyEdits(map, swap(NO_EDITS, key, d.variant, 3)));
    expect(item(after, key)).not.toBe(item(plain, key));
  });

  it("renames, moves and deletes a label", () => {
    const l = map.labels.labels.find((l) => !l.path)!;
    const key = `label:${l.id}`;
    const renamed = svgOf(applyEdits(map, rename(NO_EDITS, key, "  Dragon's   Rest ")));
    expect(item(renamed, key)).toMatch(/>Dragon's Rest</i);
    const moved = applyEdits(map, move(NO_EDITS, key, 0, 30));
    expect(moved.labels.labels.find((x) => x.id === l.id)!.box.y).toBeCloseTo(l.box.y + 30);
    expect(item(svgOf(applyEdits(map, rename(NO_EDITS, key, "   "))), key)).toBeUndefined();
  });

  it("keeps edits as values, so undo is the previous one", () => {
    const a = move(NO_EDITS, "sym:1", 1, 1);
    const b = remove(a, "sym:2");
    expect(a.deleted).toEqual([]);
    expect(editCount(b)).toBe(2);
    expect(NO_EDITS).toEqual({ moved: {}, deleted: [], variant: {}, text: {}, z: {} });
  });

  it("reuses the drawn ground between edits", () => {
    const t0 = performance.now();
    for (let n = 0; n < 5; n++) svgOf(applyEdits(map, move(NO_EDITS, "sym:1", n, n)));
    expect((performance.now() - t0) / 5).toBeLessThan(400);
  });
});

describe("layering (bring forward, send back)", () => {
  // Two overlapping mountains: a is drawn first (behind), b after it (in front).
  const pair = (() => {
    for (let i = 0; i < map.symbols.length; i++)
      for (let j = i + 1; j < map.symbols.length; j++)
        if (map.symbols[i].role === "mountain" && map.symbols[j].role === "mountain" && boxesOverlap(symBox(map.symbols[i]), symBox(map.symbols[j]))) return [`sym:${i}`, `sym:${j}`];
    throw new Error("no overlapping mountains");
  })();
  const [a, b] = pair;
  const at = (svg: string, key: string) => svg.indexOf(`data-key="${key}"`);

  it("draws later symbols in front of earlier ones", () => {
    const svg = svgOf(applyEdits(map, NO_EDITS));
    expect(at(svg, a)).toBeLessThan(at(svg, b));
  });

  it("brings a symbol in front of the one it overlaps", () => {
    const e = layer(map, NO_EDITS, a, "forward");
    expect(e).not.toBe(NO_EDITS);
    const svg = svgOf(applyEdits(map, e));
    expect(at(svg, a)).toBeGreaterThan(at(svg, b));
  });

  it("sends a symbol behind the one it overlaps", () => {
    const svg = svgOf(applyEdits(map, layer(map, NO_EDITS, b, "backward")));
    expect(at(svg, b)).toBeLessThan(at(svg, a));
  });

  it("goes all the way to the front or back", () => {
    const front = applyEdits(map, layer(map, NO_EDITS, a, "front")).symbols;
    expect(front[front.length - 1].key).toBe(a);
    const back = applyEdits(map, layer(map, NO_EDITS, b, "back")).symbols;
    expect(back[0].key).toBe(b);
  });

  it("can step back and forth repeatedly", () => {
    let e = NO_EDITS;
    for (let n = 0; n < 20; n++) e = layer(map, e, a, n % 2 ? "backward" : "forward");
    const svg = svgOf(applyEdits(map, e));
    expect(at(svg, a)).toBeLessThan(at(svg, b)); // an even number of swaps puts it back behind
    expect(editCount(e)).toBe(1);
  });

  it("does nothing when there is nothing to pass", () => {
    const e = layer(map, NO_EDITS, a, "front");
    expect(layer(map, e, a, "front")).toBe(e);
  });
});

describe("export", () => {
  it("embeds the typeface in a saved SVG", () => {
    const svg = svgOf(applyEdits(map, NO_EDITS), "@font-face{font-family:'IM Fell English';src:url(data:font/woff2;base64,AAAA)}");
    expect(svg).toMatch(/^<svg[^>]*><defs>.*?<\/defs><style>@font-face/s);
  });

  it("is a valid standalone SVG file, with nothing drawn in the paper margin", () => {
    // resvg reads SVG as strict XML, as browsers do for a saved file or an <img>.
    // A symbol dragged half off the left edge must be cut off at the frame. (Not fully off:
    // resvg, the test renderer, crashes on an ink symbol clipped away entirely; browsers do not.)
    const svg = svgOf(applyEdits(map, move(NO_EDITS, "sym:0", -map.symbols[0].x - 10, 0)), "@font-face{font-family:'IM Fell English';src:url(data:font/woff2;base64,AAAA)}");
    const W = 400;
    const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render();
    const k = W / map.settings.width;
    const margin = frameFor(map.settings.width, map.settings.height).margin * k;
    // Every pixel in the margin band is white.
    for (let y = 0; y < png.height; y += 3)
      for (const x of [0, Math.floor(margin / 2), png.width - 1 - Math.floor(margin / 2)]) {
        const i = (y * png.width + x) * 4;
        expect(png.pixels[i] + png.pixels[i + 1] + png.pixels[i + 2], `pixel ${x},${y}`).toBeGreaterThan(740);
      }
  });

  it("sizes PNGs for screen and 300 dpi A3", () => {
    expect(pngSize("screen", 1600, 2263)).toEqual([1600, 2263]);
    expect(pngSize("a3", 1600, 2263)).toEqual([3508, 4961]);
    expect(pngSize("a3", 2263, 1600)).toEqual([4961, 3508]);
  });

  it("encodes font files as base64", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(Buffer.from(toBase64(bytes), "base64").equals(Buffer.from(bytes))).toBe(true);
  });
});

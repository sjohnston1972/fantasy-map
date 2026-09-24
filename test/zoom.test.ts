import { describe, expect, it } from "vitest";
import { clampView, drawnBox, fullView, MARGIN, MAX_ZOOM, panBy, previewTransform, zoomAt, zoomLevel } from "../src/app/zoom";

const W = 1600;
const H = 2263;

describe("zoom and pan", () => {
  it("starts showing the whole map", () => {
    expect(fullView(W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(zoomLevel(fullView(W, H), W)).toBe(1);
  });

  it("keeps the point under the pointer still while zooming", () => {
    const v0 = fullView(W, H);
    const [mx, my] = [400, 900];
    const v1 = zoomAt(v0, W, H, 2, mx, my);
    expect(zoomLevel(v1, W)).toBeCloseTo(2);
    // Same share of the way across the view, before and after.
    expect((mx - v1.x) / v1.w).toBeCloseTo((mx - v0.x) / v0.w);
    expect((my - v1.y) / v1.h).toBeCloseTo((my - v0.y) / v0.h);
  });

  it("keeps the map's shape at every zoom", () => {
    let v = fullView(W, H);
    for (const f of [1.5, 3, 0.7, 5, 0.2]) {
      v = zoomAt(v, W, H, f, 800, 1000);
      expect(v.h / v.w).toBeCloseTo(H / W);
    }
  });

  it("stays between whole-map and the closest zoom", () => {
    expect(zoomLevel(zoomAt(fullView(W, H), W, H, 100, 10, 10), W)).toBeCloseTo(MAX_ZOOM);
    expect(zoomAt(fullView(W, H), W, H, 0.1, 10, 10)).toEqual(fullView(W, H));
  });

  it("never looks past the edge of the map", () => {
    const v = zoomAt(fullView(W, H), W, H, 4, W, H); // zoom into the bottom-right corner
    expect(v.x + v.w).toBeCloseTo(W);
    expect(v.y + v.h).toBeCloseTo(H);
    const far = panBy(v, W, H, 5000, 5000);
    expect(far.x + far.w).toBeCloseTo(W);
    expect(far.y + far.h).toBeCloseTo(H);
    const back = panBy(v, W, H, -99999, -99999);
    expect([back.x, back.y]).toEqual([0, 0]);
    expect(clampView({ x: -50, y: -50, w: W * 2, h: 10 }, W, H)).toEqual(fullView(W, H));
  });
});

describe("moving preview", () => {
  it("shows the live view by shifting and scaling the last drawn one", () => {
    const drawn = { x: 400, y: 600, w: 400, h: 400 * (H / W) };
    const box = [500, 500 * (H / W)] as const;
    // Panned right by 40 map pixels: the picture shifts left by 40/400 of the box.
    const pan = previewTransform(drawn, { ...drawn, x: 440 }, box[0], box[1]);
    expect(pan.k).toBe(1);
    expect(pan.tx).toBeCloseTo(-50);
    expect(pan.ty).toBeCloseTo(0);
    // A map point lands where the live view would draw it.
    const live = zoomAt(drawn, W, H, 2, 500, 700);
    const t = previewTransform(drawn, live, box[0], box[1]);
    const [px, py] = [520, 760];
    const before = [((px - drawn.x) / drawn.w) * box[0], ((py - drawn.y) / drawn.h) * box[1]];
    const shown = [t.k * (before[0] + t.tx), t.k * (before[1] + t.ty)];
    expect(shown[0]).toBeCloseTo(((px - live.x) / live.w) * box[0]);
    expect(shown[1]).toBeCloseTo(((py - live.y) / live.h) * box[1]);
  });
});

describe("drawn margin", () => {
  it("draws a quarter of a view beyond each edge", () => {
    expect(drawnBox({ x: 100, y: 200, w: 400, h: 600 })).toEqual({ x: 0, y: 50, w: 600, h: 900 });
    expect(MARGIN).toBe(0.25); // app.css places the SVG at -25% and 150% to match
  });
});

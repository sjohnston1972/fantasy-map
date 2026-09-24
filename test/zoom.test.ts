import { describe, expect, it } from "vitest";
import { clampView, fullView, MAX_ZOOM, panBy, zoomAt, zoomLevel } from "../src/app/zoom";

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

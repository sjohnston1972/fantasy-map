import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { split } from "../src/import/split";
import { DEFAULT_TRACE, MIN_PRINT_HEIGHT, medianHeight, traceIcon, type Potrace } from "../src/import/trace";

// esm-potrace-wasm is built for browsers; under Node it looks for require and __dirname.
let potrace: Potrace;
beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.require = createRequire(import.meta.url);
  g.__dirname = `${process.cwd()}/node_modules/esm-potrace-wasm/dist`;
  const mod = await import("esm-potrace-wasm");
  await mod.init();
  potrace = mod.potrace as unknown as Potrace;
});

const img = PNG.sync.read(readFileSync("example artifacts/desert.png"));
const rows = split(img).rows;
const icons = rows.flatMap((r) => r.icons);
const camel = rows[9].icons[0];

describe("tracing desert.png icons", () => {
  it("makes one clean SVG per spec 7: viewBox equals the crop, black fill, no stroke, no raster", async () => {
    const t = await traceIcon(img, camel, DEFAULT_TRACE, potrace);
    expect(t.width).toBe(camel.w * 4);
    expect(t.height).toBe(camel.h * 4);
    expect(t.svg.match(/<svg/g)).toHaveLength(1);
    expect(t.svg).toContain(`viewBox="0 0 ${t.width} ${t.height}"`);
    expect(t.svg).toContain('fill="#000"');
    expect(t.svg).not.toMatch(/stroke|<image|base64/);
    expect(t.nodes).toBeGreaterThan(20);
  });

  it("keeps the drawing inside the viewBox", async () => {
    const t = await traceIcon(img, camel, DEFAULT_TRACE, potrace);
    // Potrace paths start with absolute moves in tenths of a pixel, y measured upward.
    const starts = [...t.svg.matchAll(/M(-?\d+) (-?\d+)/g)].map((m) => [Number(m[1]) / 10, Number(m[2]) / 10]);
    expect(starts.length).toBeGreaterThan(0);
    for (const [x, y] of starts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(t.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(t.height);
    }
  });

  it("makes a transparent PNG: paper is clear, ink is black", async () => {
    const t = await traceIcon(img, camel, DEFAULT_TRACE, potrace);
    expect(t.png[3]).toBe(0); // top-left corner is paper
    let solid = 0;
    for (let i = 0; i < t.png.length; i += 4) {
      expect(t.png[i] + t.png[i + 1] + t.png[i + 2]).toBe(0);
      if (t.png[i + 3] === 255) solid++;
    }
    expect(solid).toBeGreaterThan(100);
  });

  it("traces at crop size when upscaling is off", async () => {
    const t = await traceIcon(img, camel, { ...DEFAULT_TRACE, upscale: false }, potrace);
    expect([t.width, t.height]).toEqual([camel.w, camel.h]);
  });

  it("traces all 88 icons in a few seconds", async () => {
    const t0 = Date.now();
    for (const icon of icons) expect((await traceIcon(img, icon, DEFAULT_TRACE, potrace)).nodes).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(10000);
  }, 30000);

  it("flags desert.png as screen quality (icons well under 300 px tall)", () => {
    expect(medianHeight(icons)).toBeLessThan(MIN_PRINT_HEIGHT);
  });
});

import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, split } from "../src/import/split";

const load = (name: string) => PNG.sync.read(readFileSync(`example artifacts/${name}`));

describe("split desert.png with default settings", () => {
  const img = load("desert.png");
  const result = split(img, DEFAULT_SETTINGS);

  it("finds 11 rows", () => {
    expect(result.rows).toHaveLength(11);
  });

  it("boxes at least 87 icons", () => {
    expect(result.iconCount).toBeGreaterThanOrEqual(87);
  });

  it("finds a title strip above every row", () => {
    for (const row of result.rows) {
      expect(row.title, `row ${row.index}`).not.toBeNull();
      expect(row.title!.y + row.title!.h).toBeLessThanOrEqual(row.band.y);
    }
  });

  it("runs in under 2 seconds", () => {
    expect(result.ms).toBeLessThan(2000);
  });

  it("keeps every crop inside the sheet with a bottom-centre anchor", () => {
    for (const icon of result.rows.flatMap((r) => r.icons)) {
      expect(icon.x).toBeGreaterThanOrEqual(0);
      expect(icon.y + icon.h).toBeLessThanOrEqual(img.height);
      expect(icon.anchorX).toBeGreaterThan(0.3);
      expect(icon.anchorX).toBeLessThan(0.7);
      // anchor sits on the bottom of the ink, which is the crop bottom minus the padding
      expect(icon.h * (1 - icon.anchorY)).toBeLessThanOrEqual(DEFAULT_SETTINGS.padding + 1e-9);
    }
  });

  it("is deterministic", () => {
    const again = split(img, DEFAULT_SETTINGS);
    expect({ ...again, ms: 0 }).toEqual({ ...result, ms: 0 });
  });
});

describe("split a larger sheet", () => {
  it("gives the same layout when desert.png is scaled up 2x", () => {
    const small = load("desert.png");
    const big = { width: small.width * 2, height: small.height * 2, data: new Uint8Array(small.width * small.height * 16) };
    for (let y = 0; y < big.height; y++)
      for (let x = 0; x < big.width; x++) {
        const s = ((y >> 1) * small.width + (x >> 1)) * 4;
        big.data.set(small.data.subarray(s, s + 4), (y * big.width + x) * 4);
      }
    const a = split(small);
    const b = split(big);
    expect(b.rows.map((r) => r.icons.length)).toEqual(a.rows.map((r) => r.icons.length));
  });
});

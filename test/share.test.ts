import { describe, expect, it } from "vitest";
import { decodeSettings, encodeSettings, fingerprint } from "../src/app/share";
import { generate } from "../src/gen/pipeline";
import { cleanSettings, DEFAULT_SETTINGS, type MapSettings } from "../src/gen/settings";
import { renderSvg } from "../src/gen/svg";

const plainSvg = (s: MapSettings) => {
  const m = generate(s);
  return renderSvg({ width: m.settings.width, height: m.settings.height, water: m.water, symbols: m.symbols, towns: m.towns, labels: m.labels });
};

describe("share links (spec: share link rebuilds the identical map in another browser)", () => {
  const settings = cleanSettings({ seed: 482913, width: 2263, height: 1600, sea_level: 0.42, mountain_density: 0.7, forest_density: 0.25, town_count: 9 });

  it("packs the settings into a short code", () => {
    const code = encodeSettings(settings);
    expect(code).toBe("1.acm9.l.42.70.25.9");
    expect(encodeSettings(DEFAULT_SETTINGS)).toBe("1.acm9.p.35.50.60.5");
    expect(code.length).toBeLessThan(30);
    expect(encodeURIComponent(code)).toBe(code); // safe in a URL as it is
  });

  it("reads a code back to exactly the same settings", () => {
    expect(decodeSettings(encodeSettings(settings))).toEqual({ settings, version: 1 });
    const custom = cleanSettings({ ...settings, width: 2000, height: 1400, seed: 999_999_999 });
    expect(decodeSettings(encodeSettings(custom))?.settings).toEqual(custom);
  });

  it("round-trips every slider position exactly", () => {
    for (let p = 0; p <= 100; p++) {
      const s = cleanSettings({ ...DEFAULT_SETTINGS, sea_level: Math.max(5, Math.min(90, p)) / 100, mountain_density: p / 100, forest_density: p / 100 });
      expect(decodeSettings(encodeSettings(s))?.settings).toEqual(s);
    }
  });

  it("rejects things that are not codes, and keeps odd values in bounds", () => {
    for (const junk of ["", "hello", "1.2.3", "1.acm9.p.35.50.60.5<script>", "1.acm9.q.35.50.60.5"]) expect(decodeSettings(junk)).toBeNull();
    const wild = decodeSettings("1.zzzzzzzzzz.99999x1.500.500.500.500")!.settings;
    expect(wild.width).toBe(4000);
    expect(wild.height).toBe(400);
    expect(wild.sea_level).toBe(0.9);
    expect(wild.town_count).toBe(30);
    expect(wild.seed).toBe(999_999_999);
  });

  it("rebuilds the identical map from the link", () => {
    const again = decodeSettings(encodeSettings(settings))!.settings;
    expect(fingerprint(plainSvg(again))).toBe(fingerprint(plainSvg(settings)));
  });

  // Links already shared must keep drawing the same map. If this fails because the generator
  // was changed on purpose, old links now draw a different map: bump the settings' v field
  // and keep the old generator for v1 links (see docs/open-questions.md).
  it("draws the same map for a known link as when this generator was released", () => {
    expect(fingerprint(plainSvg(decodeSettings("1.acm9.p.35.50.60.5")!.settings))).toBe(GOLDEN);
  });
});

describe("settings panel", () => {
  it("draws with the fewest and most towns the slider allows", () => {
    for (const town_count of [1, 15]) {
      const m = generate({ ...DEFAULT_SETTINGS, seed: 77, town_count });
      expect(m.towns.places.filter((p) => p.tier !== "village").length).toBeGreaterThan(0);
    }
  });

  it("changes the forests with the forest slider", () => {
    const trees = (forest_density: number) => generate({ ...DEFAULT_SETTINGS, seed: 77, forest_density }).symbols.filter((s) => s.role === "conifer" || s.role === "broadleaf").length;
    expect(trees(0.9)).toBeGreaterThan(trees(0.1));
  });
});

const GOLDEN = "m9uqo1"; // seed 482913, default settings, generator v1

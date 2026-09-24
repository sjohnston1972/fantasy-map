import { describe, expect, it } from "vitest";
import { boxesOverlap, compassBox, emblemBox, symBox, textWidth, titleFrame } from "../src/gen/labels";
import { cultureAt, Namer } from "../src/gen/names";
import { generate } from "../src/gen/pipeline";
import { rng } from "../src/gen/rng";
import { DEFAULT_SETTINGS } from "../src/gen/settings";

const SEEDS = [482913, 77, 2024, 5, 31337];
const maps = SEEDS.map((seed) => generate({ ...DEFAULT_SETTINGS, seed }));

describe("labels (spec: labels never overlap symbols or other labels)", () => {
  it("names every settlement", () => {
    for (const m of maps) {
      const named = new Set(m.labels.labels.filter((l) => l.ref !== undefined).map((l) => l.ref));
      for (const p of m.towns.places) expect(named.has(p.id), `settlement ${p.id} on seed ${m.settings.seed}`).toBe(true);
    }
  });

  it("names the sea, some regions, lakes and rivers", () => {
    const kinds = new Set(maps.flatMap((m) => m.labels.labels.map((l) => l.kind)));
    for (const k of ["capital", "town", "village", "sea", "region", "lake", "river"]) expect(kinds, k).toContain(k);
  });

  it("never lets two labels overlap", () => {
    for (const m of maps) {
      const ls = m.labels.labels;
      for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) expect(boxesOverlap(ls[i].box, ls[j].box), `${ls[i].text} / ${ls[j].text}`).toBe(false);
    }
  });

  it("never lets a label cover a symbol, a settlement, a landmark or an emblem", () => {
    for (const m of maps) {
      for (const l of m.labels.labels) {
        for (const s of m.symbols) expect(boxesOverlap(l.box, symBox(s))).toBe(false);
        for (const e of m.labels.emblems) expect(boxesOverlap(l.box, emblemBox(e))).toBe(false);
        for (const p of m.towns.places) {
          const tw = (p.tier === "capital" ? 74 : p.tier === "town" ? 56 : 40) * (Math.min(m.settings.width, m.settings.height) / 1600);
          expect(boxesOverlap(l.box, { x: p.x - tw / 2, y: p.y - tw * 0.85, w: tw, h: tw })).toBe(false);
        }
      }
    }
  });

  it("keeps lettering inside the border", () => {
    for (const m of maps) for (const l of m.labels.labels) {
      expect(l.box.x).toBeGreaterThan(0);
      expect(l.box.y).toBeGreaterThan(0);
      expect(l.box.x + l.box.w).toBeLessThan(m.settings.width);
      expect(l.box.y + l.box.h).toBeLessThan(m.settings.height);
    }
  });

  it("gives every name once per map", () => {
    for (const m of maps) {
      const texts = m.labels.labels.map((l) => l.text);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it("puts an emblem beside the capital", () => {
    for (const m of maps) {
      const capital = m.towns.places.find((p) => p.tier === "capital")!;
      expect(m.labels.emblems.some((e) => e.town === capital.id)).toBe(true);
    }
  });

  it("repeats exactly for the same seed", () => {
    const a = generate({ ...DEFAULT_SETTINGS, seed: 777 }).labels.labels.map((l) => [l.text, l.x, l.y]);
    const b = generate({ ...DEFAULT_SETTINGS, seed: 777 }).labels.labels.map((l) => [l.text, l.x, l.y]);
    expect(a).toEqual(b);
  });
});

describe("names", () => {
  it("draws names in the style of each region", () => {
    expect(cultureAt(0.05, 0.5, 0.5, 0)).toBe("norse");
    expect(cultureAt(0.95, 0.5, 0.5, 0)).toBe("southern");
    expect(cultureAt(0.5, 0.1, 0.5, 0)).toBe("celtic");
    expect(cultureAt(0.5, 0.6, 0.5, 0)).toBe("english");
  });

  it("makes readable names: no vowel clashes at the join, no repeats", () => {
    const namer = new Namer(rng(1));
    const seen = new Set<string>();
    for (let k = 0; k < 300; k++) {
      const c = (["english", "norse", "celtic", "southern"] as const)[k % 4];
      const n = namer.place(c, k % 3 === 0);
      expect(seen.has(n)).toBe(false);
      seen.add(n);
      expect(n).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/);
    }
  });

  it("estimates wider text for capitals and letter spacing", () => {
    expect(textWidth("Harrow", 20, true, 0)).toBeGreaterThan(textWidth("Harrow", 20, false, 0));
    expect(textWidth("Harrow", 20, false, 0.2)).toBeGreaterThan(textWidth("Harrow", 20, false, 0));
  });
});

describe("title and compass (generator version 3)", () => {
  it("gives every map a title named for its capital, and a compass, clear of other lettering", () => {
    for (const m of maps) {
      const title = m.labels.labels.filter((l) => l.kind === "title");
      const compass = m.labels.labels.filter((l) => l.kind === "compass");
      expect(title.length, `seed ${m.settings.seed}`).toBe(1);
      expect(compass.length).toBe(1);
      const capital = m.labels.labels.find((l) => l.kind === "capital")!;
      expect(title[0].text).toContain(capital.text);
      expect(title[0].box).toEqual(titleFrame(title[0]));
      expect(compass[0].box).toEqual(compassBox(compass[0]));
    }
  });

  it("leaves maps from earlier links without them", () => {
    const old = generate({ ...DEFAULT_SETTINGS, seed: 482913, v: 2 });
    expect(old.labels.labels.some((l) => l.kind === "title" || l.kind === "compass")).toBe(false);
  });
});

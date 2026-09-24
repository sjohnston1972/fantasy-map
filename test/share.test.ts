import { describe, expect, it } from "vitest";
import { decodeEdits, decodeSettings, encodeEdits, encodeSettings, fingerprint } from "../src/app/share";
import { addSymbol, applyEdits, layer, move, NO_EDITS, remove, rename, resize, swap } from "../src/gen/edits";
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
    expect(code).toBe("6.acm9.l.42.70.25.9.clhd.30.40");
    expect(encodeSettings(DEFAULT_SETTINGS)).toBe("6.acm9.p.35.50.60.5.clhd.30.40");
    // Links from before the sea options read with all of them off.
    expect(decodeSettings("5.acm9.p.35.50.60.5")?.settings).toMatchObject({ compass_lines: false, shallows: false, deltas: false, waves: 0, sea_life: 0 });
    const plain = { ...DEFAULT_SETTINGS, compass_lines: false, shallows: false, deltas: false, waves: 0, sea_life: 0 };
    expect(encodeSettings(plain)).toBe("6.acm9.p.35.50.60.5");
    expect(decodeSettings("6.acm9.p.35.50.60.5.ch.55.0")?.settings).toMatchObject({ compass_lines: false, shallows: true, deltas: false, waves: 0.55, sea_life: 0 });
    // The border is added only when it is not the classic one, so older links are unchanged.
    const bare = { ...DEFAULT_SETTINGS, compass_lines: false, shallows: false, deltas: false, waves: 0, sea_life: 0 };
    expect(encodeSettings({ ...bare, border: "chequered" })).toBe("6.acm9.p.35.50.60.5.k");
    expect(decodeSettings("6.acm9.p.35.50.60.5.o")?.settings.border).toBe("ornate");
    expect(decodeSettings("6.acm9.p.35.50.60.5")?.settings.border).toBe("classic");
    expect(decodeSettings("6.acm9.p.35.50.60.5.x")?.settings.border).toBe("classic");
    // The coast style rides in the same field: s after the border letter.
    expect(encodeSettings({ ...bare, coast: "stipple" })).toBe("6.acm9.p.35.50.60.5.cs");
    expect(encodeSettings({ ...bare, border: "ornate", coast: "stipple" })).toBe("6.acm9.p.35.50.60.5.os");
    expect(decodeSettings("6.acm9.p.35.50.60.5.ks")?.settings).toMatchObject({ border: "chequered", coast: "stipple" });
    expect(decodeSettings("6.acm9.p.35.50.60.5.k")?.settings.coast).toBe("ripples");
    expect(code.length).toBeLessThan(40);
    expect(encodeURIComponent(code)).toBe(code); // safe in a URL as it is
  });

  it("reads a code back to exactly the same settings", () => {
    expect(decodeSettings(encodeSettings(settings))).toEqual({ settings, version: 6 });
    // A link made before version 2 keeps version 1, so it draws the map it always did.
    const noSeaExtras = { compass_lines: false, shallows: false, deltas: false, waves: 0, sea_life: 0 };
    expect(decodeSettings("1.acm9.l.42.70.25.9")?.settings).toEqual({ ...settings, ...noSeaExtras, v: 1 });
    // A link from a newer version than this page knows is drawn with the newest it has.
    expect(decodeSettings("9.acm9.l.42.70.25.9")).toEqual({ settings: { ...settings, ...noSeaExtras }, version: 9 });
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
  // The generated map itself (places, symbols, names), not the drawing, so restyling the
  // renderer does not count as a change.
  it("generates the same map for a known link as when this generator was released", () => {
    const m = generate(decodeSettings("1.acm9.p.35.50.60.5")!.settings);
    const data = JSON.stringify([m.symbols, m.towns.places, m.towns.roads.map((r) => r.cells), m.labels.labels.map((l) => [l.text, l.x, l.y]), m.water.rivers.map((r) => r.cells)]);
    expect(fingerprint(data)).toBe(GOLDEN);
  });
});

describe("edits in share links", () => {
  const map = generate(DEFAULT_SETTINGS);

  it("leaves the edits part out when there are none", async () => {
    expect(await encodeEdits(NO_EDITS)).toBe("");
    expect(await decodeEdits("")).toEqual(NO_EDITS);
  });

  it("carries every kind of edit through a link exactly", async () => {
    let e = move(NO_EDITS, "sym:3", 12.34, -5.01);
    e = remove(e, "town:2");
    e = swap(e, "sym:7", 0.1, 3);
    e = rename(e, "label:4", "Dragon's Rest & Co <b>");
    e = layer(map, e, "sym:3", "front");
    e = addSymbol(e, { role: "conifer", x: 812.34, y: 1003.21, w: 13.37, h: 21.9, variant: 0.3125, flip: true }).edits;
    e = move(e, "add:1", 3, 4);
    e = layer(map, e, "add:1", "back");
    e = resize(resize(e, "add:1", 1.7), "label:4", 0.8);
    e = addSymbol(e, { role: "village", x: 500, y: 600, w: 40, h: 40, variant: 0.125, flip: false, name: "Little Ashford" }).edits;
    e = rename(e, "add:2", "");
    const code = await encodeEdits(e);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeEdits(code)).toEqual(e);
    const plain = (m: ReturnType<typeof applyEdits>) =>
      fingerprint(renderSvg({ width: m.settings.width, height: m.settings.height, water: m.water, symbols: m.symbols, towns: m.towns, labels: m.labels }));
    expect(plain(applyEdits(map, (await decodeEdits(code))!))).toBe(plain(applyEdits(map, e)));
  });

  it("stays short for a typical session of edits", async () => {
    let e = NO_EDITS;
    for (let k = 0; k < 40; k++) e = move(e, `sym:${k * 7}`, k * 1.5, -k);
    for (let k = 0; k < 10; k++) e = remove(e, `sym:${k * 11 + 3}`);
    expect((await encodeEdits(e)).length).toBeLessThan(700);
  });

  it("refuses broken or hostile edits", async () => {
    expect(await decodeEdits("not base64 at all!")).toBeNull();
    expect(await decodeEdits("AAAA")).toBeNull();
    // A small link that inflates to something huge (a "zip bomb") is refused.
    const bomb = JSON.stringify({ t: { l1: "x".repeat(2_000_000) } });
    const packed = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    expect(await decodeEdits(Buffer.from(packed).toString("base64url"))).toBeNull();
  });

  it("checks added symbols read from a link", async () => {
    const raw = JSON.stringify({ a: { a1: ["mountain", 10, 20, 9999, 30, 0.5, 1], a2: ["<script>", 1, 1, 10, 10, 0.5, 0], a3: ["hill", "x", 1, 10, 10, 0.5, 0], s4: ["hill", 1, 1, 10, 10, 0.5, 0] } });
    const packed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    expect((await decodeEdits(Buffer.from(packed).toString("base64url")))?.added).toEqual({ "add:1": { role: "mountain", x: 10, y: 20, w: 600, h: 30, variant: 0.5, flip: true } });
    // Kinds from the library have hyphenated names, and must survive a link too.
    const lib = new Uint8Array(await new Response(new Blob([JSON.stringify({ a: { a1: ["sea-monsters-and-serpents", 10, 20, 30, 30, 0.5, 0] } })]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    expect((await decodeEdits(Buffer.from(lib).toString("base64url")))?.added["add:1"]?.role).toBe("sea-monsters-and-serpents");
  });

  it("drops unknown keys and clamps odd values", async () => {
    const raw = JSON.stringify({ m: { s1: [1e12, 2], x9: [1, 1], s2: "no" }, d: ["t1", "zz", 5], v: { s3: 7 }, t: { s4: "not a label", l2: "Ok" }, z: { l3: 1 } });
    const packed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    expect(await decodeEdits(Buffer.from(packed).toString("base64url"))).toEqual({
      moved: { "sym:1": [10000, 2] },
      deleted: ["town:1"],
      variant: { "sym:3": 0.999999 },
      text: { "label:2": "Ok" },
      z: {},
      added: {},
      scale: {},
    });
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

const GOLDEN = "r9akb3"; // seed 482913, default settings, generator v1 // seed 482913, default settings, generator v1

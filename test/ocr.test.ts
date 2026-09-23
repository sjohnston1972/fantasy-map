import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { createWorker, PSM } from "tesseract.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanCategory, prepareTitle, TITLE_CHARS } from "../src/import/ocr";
import { split } from "../src/import/split";

// Same engine, language data and settings as the browser page.
let worker: Awaited<ReturnType<typeof createWorker>>;
beforeAll(async () => {
  worker = await createWorker("eng", 1, { langPath: "node_modules/@tesseract.js-data/eng/4.0.0_best_int", gzip: true, cachePath: process.env.TEMP ?? "/tmp" });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: TITLE_CHARS });
}, 60000);
afterAll(() => worker?.terminate());

async function readTitles(name: string) {
  const img = PNG.sync.read(readFileSync(`example artifacts/${name}`));
  const out: string[] = [];
  for (const row of split(img).rows) {
    const p = prepareTitle(img, row.title!);
    const png = new PNG({ width: p.width, height: p.height });
    png.data = Buffer.from(p.data);
    out.push(cleanCategory((await worker.recognize(PNG.sync.write(png))).data.text));
  }
  return out;
}

describe("row title OCR", () => {
  it("reads at least 9 of the 11 desert.png titles (spec 11)", async () => {
    const expected = ["sand dunes", "rock formations", "cacti", "oases", "desert plants", "dry riverbeds", "skeletons & bones", "ruins", "settlements", "miscellaneous", "map symbols"];
    const got = await readTitles("desert.png");
    const right = got.filter((t, i) => t === expected[i]).length;
    expect(right, JSON.stringify(got)).toBeGreaterThanOrEqual(9);
  }, 60000);

  it("reads titles with brackets, commas and ampersands", async () => {
    const got = await readTitles("gods and demons.png");
    expect(got).toContain("gods of love, life & healing");
    expect((await readTitles("monsters.png"))[0]).toBe("land beasts (common)");
  }, 60000);
});

describe("cleanCategory", () => {
  it("lower-cases, trims and drops stray characters", () => {
    expect(cleanCategory("  SAND  DUNES|\n")).toBe("sand dunes");
  });
});

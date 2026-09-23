// Bundles the browser code into public/, copies the sample sheet next to the import
// page, and copies the OCR engine and its English data so the page never loads code
// from another site.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

await build({
  entryPoints: ["src/import/app.ts"],
  outfile: "public/admin/import/app.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: true,
  sourcemap: true,
  logLevel: "warning",
});

copyFileSync("example artifacts/desert.png", "public/admin/import/sample-desert.png");

const ocr = "public/admin/import/ocr";
mkdirSync(`${ocr}/core`, { recursive: true });
mkdirSync(`${ocr}/lang`, { recursive: true });
copyFileSync("node_modules/tesseract.js/dist/worker.min.js", `${ocr}/worker.min.js`);
// The LSTM engine builds only; the worker picks the fastest one the browser supports.
for (const f of readdirSync("node_modules/tesseract.js-core")) {
  if (/lstm\.wasm\.js$/.test(f)) copyFileSync(`node_modules/tesseract.js-core/${f}`, `${ocr}/core/${f}`);
}
copyFileSync("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", `${ocr}/lang/eng.traineddata.gz`);

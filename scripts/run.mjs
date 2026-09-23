// Runs a TypeScript script from scripts/ with the project's source code: bundles it with
// esbuild into .tmp/ and imports it. Usage: node scripts/run.mjs scripts/import-sheets.ts [args]
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const [entry, ...args] = process.argv.slice(2);
if (!entry) throw new Error("usage: node scripts/run.mjs <script.ts> [args]");
mkdirSync(".tmp", { recursive: true });
const outfile = `.tmp/${basename(entry, ".ts")}.mjs`;
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "warning",
  // Libraries with their own WebAssembly or data files load from node_modules as usual.
  external: ["tesseract.js", "esm-potrace-wasm", "pngjs", "@resvg/resvg-js", "esbuild"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
process.argv = [process.argv[0], outfile, ...args];
await import(pathToFileURL(outfile).href);

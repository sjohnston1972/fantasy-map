// Bundles the browser code into public/ and copies the sample sheet next to the import page.
import { build } from "esbuild";
import { copyFileSync } from "node:fs";

await build({
  entryPoints: ["src/import/app.ts"],
  outfile: "public/admin/import/app.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: true,
  logLevel: "warning",
});

copyFileSync("example artifacts/desert.png", "public/admin/import/sample-desert.png");

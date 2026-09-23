// Rebuilds the symbol packs in the live library from the approved icons (the same code the
// Worker runs for POST /api/import/packs/build). Usage: node scripts/run.mjs scripts/build-packs.ts
import { readFileSync } from "node:fs";
import { buildPacks } from "../src/api/packs";
import { configFromEnv, d1, r2, readDotEnv } from "./cf-storage";

const cfg = configFromEnv(readDotEnv(readFileSync(".env", "utf8")));
const manifest = await buildPacks({ DB: d1(cfg), LIBRARY: r2(cfg) });
console.log(JSON.stringify(manifest, null, 2));

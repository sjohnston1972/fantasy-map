// Share codes (spec: "The settings are compressed into a short code in the URL. Opening the
// URL rebuilds the identical map, so no maps are stored on the server."). Like a short
// config string, each setting is one field, separated by dots:
//
//   1.acm9.p.35.50.60.5
//   | |    | |  |  |  number of towns
//   | |    | |  |  forest density, per cent
//   | |    | |  mountain density, per cent
//   | |    | sea level, per cent
//   | |    shape: p (A portrait), l (A landscape), or a size such as 2000x1400
//   | seed, in base 36 to keep it short
//   generator version (the settings' v field)
//
// The sliders work in whole per cents, so the per cent values round-trip exactly and the
// map rebuilt from a code is the same map.

import { MAX_SCALE, MIN_SCALE, NO_EDITS, type Edits } from "../gen/edits";
import { cleanSettings, type MapSettings } from "../gen/settings";

const SHAPES: Record<string, [number, number]> = { p: [1600, 2263], l: [2263, 1600] };
const pct = (x: number) => Math.round(x * 100);

export function encodeSettings(s: MapSettings): string {
  const shape = Object.keys(SHAPES).find((k) => SHAPES[k][0] === s.width && SHAPES[k][1] === s.height) ?? `${s.width}x${s.height}`;
  return [s.v, s.seed.toString(36), shape, pct(s.sea_level), pct(s.mountain_density), pct(s.forest_density), s.town_count].join(".");
}

// Read a share code back into settings. Returns null for anything that is not a code; the
// values are checked and kept in bounds like any other settings.
export function decodeSettings(code: string): { settings: MapSettings; version: number } | null {
  const parts = code.trim().split(".");
  if (parts.length < 7 || !parts.every((p) => /^[0-9a-z]+$/i.test(p))) return null;
  const [v, seed, shape, sea, mountains, forest, towns] = parts;
  const version = Number(v);
  const size = SHAPES[shape] ?? shape.match(/^(\d+)x(\d+)$/)?.slice(1).map(Number);
  const seedNum = parseInt(seed, 36);
  if (!Number.isInteger(version) || !size || !Number.isFinite(seedNum)) return null;
  const settings = cleanSettings({
    v: version,
    seed: seedNum,
    width: size[0],
    height: size[1],
    sea_level: Number(sea) / 100,
    mountain_density: Number(mountains) / 100,
    forest_density: Number(forest) / 100,
    town_count: Number(towns),
  });
  return { settings, version };
}

// A short fingerprint of a drawn map, shown under it, so two people can check at a glance
// that a shared link gave them the same map (FNV-1a hash of the SVG, as 6 characters).
export function fingerprint(svg: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < svg.length; i++) {
    h ^= svg.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}

// ---- Edits in the link ----
// Edits travel in a second part of the link (&e=...): a compact list of changes, squeezed
// with deflate and written in URL-safe base64. Keys are shortened (sym:12 becomes s12).


const SHORT: Record<string, string> = { sym: "s", town: "t", landmark: "k", bridge: "b", emblem: "e", label: "l", add: "a" };
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const MAX_EDITS = 5000; // far more than anyone makes by hand; stops a hostile link hanging the page
const MAX_BYTES = 256 * 1024;

const shortKey = (key: string) => {
  const [kind, id] = key.split(":");
  return SHORT[kind] + id;
};
const longKey = (k: string): string | null => {
  const m = /^([stkbela])(\d{1,6})$/.exec(k);
  return m ? `${LONG[m[1]]}:${Number(m[2])}` : null;
};
const mapKeys = <T>(r: Record<string, T>, f: (k: string) => string | null) => Object.fromEntries(Object.entries(r).flatMap(([k, v]) => (f(k) ? [[f(k)!, v]] : [])));

export function isEmptyEdits(e: Edits): boolean {
  return !e.deleted.length && ![e.moved, e.variant, e.text, e.z, e.added, e.scale].some((r) => Object.keys(r).length);
}

export async function encodeEdits(e: Edits): Promise<string> {
  if (isEmptyEdits(e)) return "";
  const added = Object.fromEntries(Object.entries(e.added).map(([k, a]) => [shortKey(k), [a.role, a.x, a.y, a.w, a.h, a.variant, a.flip ? 1 : 0, ...(a.name ? [a.name] : [])]]));
  const compact = { m: mapKeys(e.moved, shortKey), d: e.deleted.map(shortKey), v: mapKeys(e.variant, shortKey), t: mapKeys(e.text, shortKey), z: mapKeys(e.z, shortKey), a: added, r: mapKeys(e.scale, shortKey) };
  const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(compact)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Read edits from a link. Anything malformed gives null; odd values are dropped or clamped,
// since a link can come from anyone.
export async function decodeEdits(code: string): Promise<Edits | null> {
  if (!code) return NO_EDITS;
  if (!/^[A-Za-z0-9_-]{1,100000}$/.test(code)) return null;
  try {
    const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    const packed = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const reader = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) return null;
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
    const raw = JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer())) as Record<string, unknown>;
    const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
    const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
    const e: Edits = { moved: {}, deleted: [], variant: {}, text: {}, z: {}, added: {}, scale: {} };
    let count = 0;
    const room = () => ++count <= MAX_EDITS;
    for (const [k, v] of Object.entries(obj(raw.m))) {
      const key = longKey(k);
      const dx = Array.isArray(v) ? num(v[0], -10000, 10000) : null;
      const dy = Array.isArray(v) ? num(v[1], -10000, 10000) : null;
      if (key && dx !== null && dy !== null && room()) e.moved[key] = [dx, dy];
    }
    for (const k of Array.isArray(raw.d) ? raw.d : []) {
      const key = typeof k === "string" ? longKey(k) : null;
      if (key && !e.deleted.includes(key) && room()) e.deleted.push(key);
    }
    for (const [k, v] of Object.entries(obj(raw.v))) {
      const key = longKey(k);
      const n = num(v, 0, 0.999999);
      if (key && n !== null && room()) e.variant[key] = n;
    }
    for (const [k, v] of Object.entries(obj(raw.t))) {
      const key = longKey(k);
      // Names' wording; an added town's name may also be cleared (empty).
      if (key && (key.startsWith("label:") ? typeof v === "string" && v.trim() : key.startsWith("add:") && typeof v === "string") && room()) e.text[key] = (v as string).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60);
    }
    for (const [k, v] of Object.entries(obj(raw.z))) {
      const key = longKey(k);
      const n = num(v, -1e9, 1e9);
      if (key && /^(sym|add):/.test(key) && n !== null && room()) e.z[key] = n;
    }
    for (const [k, v] of Object.entries(obj(raw.r))) {
      const key = longKey(k);
      const n = num(v, MIN_SCALE, MAX_SCALE);
      if (key && n !== null && room()) e.scale[key] = n;
    }
    for (const [k, v] of Object.entries(obj(raw.a))) {
      const key = longKey(k);
      if (!key?.startsWith("add:") || !Array.isArray(v) || !room()) continue;
      const [role, x, y, w, h, variant, flip, name] = v;
      const nums = [num(x, -1000, 10000), num(y, -1000, 10000), num(w, 2, 600), num(h, 2, 600), num(variant, 0, 0.999999)];
      if (typeof role !== "string" || !/^[a-z]{2,20}$/.test(role) || nums.some((n) => n === null)) continue;
      e.added[key] = { role, x: nums[0]!, y: nums[1]!, w: nums[2]!, h: nums[3]!, variant: nums[4]!, flip: flip === 1, ...(typeof name === "string" && name.trim() ? { name: name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 40) } : {}) };
    }
    return e;
  } catch {
    return null;
  }
}

// Tracing (spec section 7): turn an icon crop into a clean SVG and a transparent PNG.
// The potrace engine is passed in, so this file runs the same in the page and in tests.

import type { Box, ImageLike } from "./split";

export interface TraceSettings {
  turdsize: number; // specks smaller than this many pixels are dropped
  alphamax: number; // corner smoothness: 0 sharp corners, 1.3 very round
  opttolerance: number; // how freely curves are joined; higher gives fewer nodes
  upscale: boolean; // 4x bicubic enlargement before tracing, for small sheets
  level: number; // grey level (0 to 255) below which a pixel is traced as ink
}

// Tracing uses mid-grey (128) as the ink level, not the splitter's generous 200: after
// enlarging, soft grey edges would otherwise count as ink and fine hatching fills in.
export const DEFAULT_TRACE: TraceSettings = { turdsize: 2, alphamax: 1.0, opttolerance: 0.2, upscale: true, level: 128 };

// Spec 7: icons shorter than this (median, in sheet pixels) are screen quality only.
export const MIN_PRINT_HEIGHT = 300;
export const UPSCALE = 4;

// The potrace call, as provided by esm-potrace-wasm with pathonly set.
export type Potrace = (
  image: { width: number; height: number; data: Uint8ClampedArray },
  options: Record<string, number | boolean>,
) => Promise<string[]>;

export interface Traced {
  width: number; // crop size after any upscale; the SVG viewBox matches it
  height: number;
  svg: string;
  png: Uint8ClampedArray<ArrayBuffer>; // RGBA, black ink on transparent
  nodes: number; // path commands, a rough measure of file complexity
}

export function medianHeight(boxes: Box[]): number {
  if (!boxes.length) return 0;
  const hs = boxes.map((b) => b.h).sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)];
}

export async function traceIcon(img: ImageLike, box: Box, s: TraceSettings, potrace: Potrace): Promise<Traced> {
  const scale = s.upscale ? UPSCALE : 1;
  const grey = cropGrey(img, box, scale);
  const { width, height } = grey;

  // Pure black and white for potrace.
  const bw = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, i = 0; p < grey.data.length; p++, i += 4) {
    const v = grey.data[p] < s.level ? 0 : 255;
    bw[i] = bw[i + 1] = bw[i + 2] = v;
    bw[i + 3] = 255;
  }
  const paths = await potrace(
    { width, height, data: bw },
    {
      turdsize: s.turdsize,
      turnpolicy: 4, // potrace's default "minority" rule for ambiguous corners
      alphamax: s.alphamax,
      opticurve: 1,
      opttolerance: s.opttolerance,
      pathonly: true,
      extractcolors: false,
      posterizelevel: 2,
      posterizationalgorithm: 0,
    },
  );
  const d = paths.join("");
  return { width, height, svg: buildSvg(d, width, height), png: transparentPng(grey.data, width, height), nodes: countNodes(d) };
}

// Spec 7: one <svg>, viewBox equal to the crop size, black fill, no stroke, no raster.
// Potrace writes coordinates at ten times the pixel size with y pointing up, so the
// path carries the same transform potrace's own SVG output uses. fill-rule evenodd keeps
// the holes inside shapes (an eye, an arch) open.
export function buildSvg(d: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path fill="#000" fill-rule="evenodd" transform="translate(0,${height}) scale(0.1,-0.1)" d="${d}"/></svg>`;
}

function countNodes(d: string): number {
  return (d.match(/[MLCZmlcz]/g) ?? []).length;
}

// Black ink on a transparent background: darker pixels become more opaque, paper
// becomes fully clear, so icons can overlap on the map without white boxes.
export function transparentPng(grey: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const paper = 235; // this light or lighter is background
  const ink = 60; // this dark or darker is solid ink
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    const a = ((paper - grey[p]) / (paper - ink)) * 255;
    out[i + 3] = a; // colour stays 0,0,0 (black); clamped array keeps alpha in 0..255
  }
  return out;
}

// Greyscale copy of a box of the sheet, enlarged by `scale` with bicubic smoothing.
export function cropGrey(img: ImageLike, box: Box, scale: number): { width: number; height: number; data: Uint8ClampedArray } {
  const grey = (x: number, y: number) => {
    const cx = Math.min(img.width - 1, Math.max(0, x));
    const cy = Math.min(img.height - 1, Math.max(0, y));
    const i = (cy * img.width + cx) * 4;
    if (img.data[i + 3] < 128) return 255;
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  };
  const width = box.w * scale;
  const height = box.h * scale;
  const data = new Uint8ClampedArray(width * height);
  if (scale === 1) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = grey(box.x + x, box.y + y);
    return { width, height, data };
  }
  // Catmull-Rom bicubic, done as a horizontal pass then a vertical pass.
  const src = new Float32Array((box.w + 4) * (box.h + 4));
  const sw = box.w + 4;
  for (let y = -2; y < box.h + 2; y++) for (let x = -2; x < box.w + 2; x++) src[(y + 2) * sw + x + 2] = grey(box.x + x, box.y + y);
  const mid = new Float32Array(width * (box.h + 4));
  for (let y = 0; y < box.h + 4; y++) {
    for (let x = 0; x < width; x++) {
      const sx = (x + 0.5) / scale - 0.5;
      const x0 = Math.floor(sx);
      const t = sx - x0;
      let v = 0;
      for (let k = -1; k <= 2; k++) v += src[y * sw + x0 + k + 2] * cubic(k - t);
      mid[y * width + x] = v;
    }
  }
  for (let y = 0; y < height; y++) {
    const sy = (y + 0.5) / scale - 0.5;
    const y0 = Math.floor(sy);
    const t = sy - y0;
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = -1; k <= 2; k++) v += mid[(y0 + k + 2) * width + x] * cubic(k - t);
      data[y * width + x] = v;
    }
  }
  return { width, height, data };
}

function cubic(x: number): number {
  const a = Math.abs(x);
  if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
}

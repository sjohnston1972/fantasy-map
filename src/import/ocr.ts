// Row title OCR helpers (spec section 5). The OCR engine itself (tesseract.js) runs
// elsewhere; this file only prepares the title image and tidies the text it returns,
// so both steps can be tested without a browser.

import type { Box, ImageLike } from "./split";

// Title letters are about 10 px tall on a 1024 px sheet; OCR reads best at 30 to 40 px.
const TARGET_TEXT_HEIGHT = 36;

// Cut the title out of the sheet, turn it grey, enlarge it smoothly and add a white
// margin. Returns RGBA pixels ready for the OCR engine.
export function prepareTitle(img: ImageLike, box: Box): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } {
  const scale = Math.max(1, TARGET_TEXT_HEIGHT / box.h);
  const margin = Math.round(TARGET_TEXT_HEIGHT / 2);
  const w = Math.round(box.w * scale) + 2 * margin;
  const h = Math.round(box.h * scale) + 2 * margin;
  const out = new Uint8ClampedArray(w * h * 4).fill(255);
  const grey = (x: number, y: number) => {
    const cx = Math.min(img.width - 1, Math.max(0, x));
    const cy = Math.min(img.height - 1, Math.max(0, y));
    const i = (cy * img.width + cx) * 4;
    if (img.data[i + 3] < 128) return 255;
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  };
  for (let y = 0; y < h - 2 * margin; y++) {
    const sy = box.y + (y + 0.5) / scale - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < w - 2 * margin; x++) {
      const sx = box.x + (x + 0.5) / scale - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      // Bilinear blend of the four nearest sheet pixels.
      const v =
        grey(x0, y0) * (1 - fx) * (1 - fy) +
        grey(x0 + 1, y0) * fx * (1 - fy) +
        grey(x0, y0 + 1) * (1 - fx) * fy +
        grey(x0 + 1, y0 + 1) * fx * fy;
      const o = ((y + margin) * w + x + margin) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
    }
  }
  return { width: w, height: h, data: out };
}

// Characters the titles use; anything else the OCR reports is noise.
export const TITLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ&(),'- ";

// Spec 5: pre-fill the category with the OCR text, lower-cased and trimmed.
export function cleanCategory(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z&(),' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

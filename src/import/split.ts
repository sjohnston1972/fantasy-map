// Sheet splitter: turns one symbol sheet image into rows, title strips and icon boxes.
// Pure logic with no browser or server dependencies, so the same code runs in the
// page and in the tests. Section numbers refer to docs/sheet-import-spec.md.

export interface SplitSettings {
  threshold: number; // 4.1 greyscale value below which a pixel counts as ink
  rowGap: number; // 4.2 blank lines needed to separate rows
  colGap: number; // 4.4 blank columns needed to separate icons
  mergeRadius: number; // 4.5 how far ink is grown before counting blobs
  noiseSize: number; // 4.5 blobs smaller than this in both directions are ignored
  padding: number; // 4.6 space added around each crop
  expectedPerRow: number; // rows with a different icon count are flagged
  titleMaxHeight: number; // 4.3 title strips are shorter than this
  titleMinWidth: number; // 4.3 title strips are wider than this
}

// Pixel settings are tuned for a 1024 px wide sheet and scaled to the real width.
export const REFERENCE_WIDTH = 1024;

export const DEFAULT_SETTINGS: SplitSettings = {
  threshold: 200,
  rowGap: 12,
  colGap: 14,
  mergeRadius: 9,
  noiseSize: 12,
  padding: 2,
  expectedPerRow: 8,
  titleMaxHeight: 25,
  titleMinWidth: 60,
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type IconFlag = "possible-merge" | "possible-split";

export interface IconBox extends Box {
  row: number; // 1-based
  col: number; // 1-based
  anchorX: number; // 0 to 1, fraction of crop width
  anchorY: number; // 0 to 1, fraction of crop height
  flags: IconFlag[];
  extras: Box[]; // other blobs in the same cell, offered as a possible split
}

export interface RowResult {
  index: number; // 1-based
  band: Box; // the icon area of the row
  title: Box | null;
  titleTouching: boolean; // title was not separated from the icons by a full gutter
  icons: IconBox[];
  countMismatch: boolean; // icon count differs from expectedPerRow
}

export interface SplitResult {
  width: number;
  height: number;
  scale: number;
  rows: RowResult[];
  iconCount: number;
  ms: number;
}

export interface ImageLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array; // RGBA, 4 bytes per pixel
}

export function split(img: ImageLike, settings: SplitSettings = DEFAULT_SETTINGS): SplitResult {
  const t0 = now();
  const { width: W, height: H } = img;
  const scale = W / REFERENCE_WIDTH;
  const px = (v: number) => Math.max(1, Math.round(v * scale));
  const rowGap = px(settings.rowGap);
  const colGap = px(settings.colGap);
  const mergeRadius = px(settings.mergeRadius);
  const noise = px(settings.noiseSize);
  const pad = px(settings.padding);
  const titleMaxH = px(settings.titleMaxHeight);
  const titleMinW = px(settings.titleMinWidth);

  const mask = inkMask(img, settings.threshold);

  // 4.2 Rows: bands of ink separated by blank gutters.
  const rowProfile = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    const o = y * W;
    for (let x = 0; x < W; x++) n += mask[o + x];
    rowProfile[y] = n;
  }
  const bands = runsBetweenGaps(rowProfile, 0, H, rowGap);

  // 4.3 Classify each band as a title strip or an icon row, peeling off titles
  // that sit inside an icon band because the gap under them was too narrow.
  const rows: RowResult[] = [];
  let pendingTitle: Box | null = null;
  for (const [y0, y1] of bands) {
    const box = inkBox(mask, W, 0, y0, W, y1);
    if (!box) continue;
    if (looksLikeTitle(box, titleMaxH, titleMinW)) {
      pendingTitle = box;
      continue;
    }
    if (box.h < noise && box.w < noise) continue; // stray speck

    let band = box;
    let title = pendingTitle;
    let touching = false;
    pendingTitle = null;

    if (!title) {
      // A title separated by a gap narrower than rowGap: the first ink segment is short and wide.
      const segs = runsBetweenGaps(rowProfile, band.y, band.y + band.h, 1);
      if (segs.length > 1) {
        const [s0, s1] = segs[0];
        const top = inkBox(mask, W, 0, s0, W, s1);
        if (top && looksLikeTitle(top, titleMaxH, titleMinW)) {
          title = top;
          touching = true;
          band = inkBox(mask, W, 0, segs[1][0], W, band.y + band.h) ?? band;
        }
      }
    }
    if (!title) {
      // Title text physically touching the icon rows: find it as a cluster of letter blobs.
      const found = findTouchingTitle(mask, W, band, titleMaxH, titleMinW);
      if (found) {
        title = found;
        touching = true;
        band = inkBox(mask, W, band.x, band.y, band.x + band.w, band.y + band.h) ?? band;
      }
    }

    rows.push({
      index: rows.length + 1,
      band,
      title,
      titleTouching: touching,
      icons: [],
      countMismatch: false,
    });
  }

  // 4.4 to 4.6 Columns, blobs and crops within each icon row.
  for (const row of rows) {
    const { band } = row;
    const colProfile = new Int32Array(W);
    for (let y = band.y; y < band.y + band.h; y++) {
      const o = y * W;
      for (let x = band.x; x < band.x + band.w; x++) colProfile[x] += mask[o + x];
    }
    const cells = runsBetweenGaps(colProfile, band.x, band.x + band.w, colGap);
    const cellWidths = cells.map(([a, b]) => b - a).sort((a, b) => a - b);
    const medianW = cellWidths.length ? cellWidths[Math.floor(cellWidths.length / 2)] : 0;

    for (const [x0, x1] of cells) {
      const blobs = cellBlobs(mask, W, x0, band.y, x1, band.y + band.h, mergeRadius, noise);
      if (!blobs.length) continue;
      const [main, ...rest] = blobs;
      const flags: IconFlag[] = [];
      if (rest.length) flags.push("possible-split");
      if (x1 - x0 > 1.6 * medianW) flags.push("possible-merge");
      const crop = padBox(main, pad, W, H);
      row.icons.push({
        ...crop,
        row: row.index,
        col: row.icons.length + 1,
        // 4.6 anchor: bottom centre of the ink, as a fraction of the crop
        anchorX: (main.x + main.w / 2 - crop.x) / crop.w,
        anchorY: (main.y + main.h - crop.y) / crop.h,
        flags,
        extras: rest.map((b) => padBox(b, pad, W, H)),
      });
    }
    row.countMismatch = settings.expectedPerRow > 0 && row.icons.length !== settings.expectedPerRow;
  }

  return {
    width: W,
    height: H,
    scale,
    rows,
    iconCount: rows.reduce((n, r) => n + r.icons.length, 0),
    ms: now() - t0,
  };
}

export function iconId(sheetId: string, icon: { row: number; col: number }): string {
  return `${sheetId}-r${icon.row}-c${icon.col}`;
}

// 4.1 Ink mask: 1 where the pixel is dark enough to be ink, 0 for background.
function inkMask(img: ImageLike, threshold: number): Uint8Array {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
    if (data[i + 3] < 128) continue; // transparent counts as background
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (grey < threshold) mask[p] = 1;
  }
  return mask;
}

// Spans of a profile between blank runs longer than minGap. Blank runs at either
// end always count as gaps. Returns [start, end) pairs.
function runsBetweenGaps(profile: Int32Array, from: number, to: number, minGap: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let blank = 0;
  for (let i = from; i < to; i++) {
    if (profile[i] > 0) {
      if (start < 0) start = i;
      blank = 0;
    } else if (start >= 0) {
      blank++;
      if (blank >= minGap) {
        out.push([start, i - blank + 1]);
        start = -1;
        blank = 0;
      }
    }
  }
  if (start >= 0) out.push([start, to - blank]);
  return out;
}

// Tight bounding box of the ink inside a rectangle, or null if it is empty.
function inkBox(mask: Uint8Array, W: number, x0: number, y0: number, x1: number, y1: number): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    const o = y * W;
    for (let x = x0; x < x1; x++) {
      if (!mask[o + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function padBox(b: Box, pad: number, W: number, H: number): Box {
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  return { x, y, w: Math.min(W, b.x + b.w + pad) - x, h: Math.min(H, b.y + b.h + pad) - y };
}

interface Blob extends Box {
  area: number;
  pixels: number[];
}

// Connected groups of ink (8-way) inside a rectangle of the mask.
function components(mask: Uint8Array, W: number, x0: number, y0: number, x1: number, y1: number): Blob[] {
  const w = x1 - x0;
  const h = y1 - y0;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const out: Blob[] = [];
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const s = sy * w + sx;
      if (seen[s] || !mask[(sy + y0) * W + sx + x0]) continue;
      seen[s] = 1;
      stack.push(s);
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      const pixels: number[] = [];
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w;
        const py = (p - px) / w;
        pixels.push((py + y0) * W + px + x0);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            if (nx < 0 || nx >= w) continue;
            const n = ny * w + nx;
            if (seen[n] || !mask[(ny + y0) * W + nx + x0]) continue;
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      out.push({ x: minX + x0, y: minY + y0, w: maxX - minX + 1, h: maxY - minY + 1, area: pixels.length, pixels });
    }
  }
  return out;
}

// 4.3 A title strip is short, and either wider than titleMinWidth or at least three
// times wider than it is tall (short words such as "CACTI" are narrower than titleMinWidth).
function looksLikeTitle(box: Box, titleMaxH: number, titleMinW: number): boolean {
  const minLetter = Math.max(3, Math.round(titleMaxH / 5));
  if (box.h >= titleMaxH || box.h < minLetter) return false;
  return box.w > titleMinW || box.w >= 3 * box.h;
}

// 4.3 fallback: title letters touching the icons below them. Looks for a left-aligned
// chain of letter-sized blobs across the top of the band. On success the letters are
// erased from the mask (so columns ignore them) and the title box is returned.
function findTouchingTitle(mask: Uint8Array, W: number, band: Box, titleMaxH: number, titleMinW: number): Box | null {
  const topH = Math.min(band.h, titleMaxH * 2);
  const blobs = components(mask, W, band.x, band.y, band.x + band.w, band.y + topH);
  const minLetter = Math.max(3, Math.round(titleMaxH / 5));
  const letters = blobs
    .filter((b) => b.h >= minLetter && b.h < titleMaxH && b.w < titleMaxH * 2 && b.y < band.y + titleMaxH)
    .filter((b) => b.y + b.h < band.y + topH) // not cut off by the window, so not part of an icon
    .sort((a, b) => a.x - b.x);
  if (letters.length < 3 || letters[0].x > band.x + band.w / 4) return null;

  const chain = [letters[0]];
  let right = letters[0].x + letters[0].w;
  for (const b of letters.slice(1)) {
    if (b.x - right > titleMaxH) break;
    const top = Math.min(...chain.map((c) => c.y), b.y);
    const bottom = Math.max(...chain.map((c) => c.y + c.h), b.y + b.h);
    if (bottom - top >= titleMaxH) continue; // off the text line
    chain.push(b);
    right = Math.max(right, b.x + b.w);
  }
  if (chain.length < 3) return null;
  const x = chain[0].x;
  const y = Math.min(...chain.map((c) => c.y));
  const box = { x, y, w: right - x, h: Math.max(...chain.map((c) => c.y + c.h)) - y };
  if (box.w <= titleMinW || box.h >= titleMaxH) return null;
  for (const c of chain) for (const p of c.pixels) mask[p] = 0;
  return box;
}

// 4.5 Blob fallback: grow the ink by radius r, group it, and report each group's
// real ink extent, largest first. Groups smaller than noise in both directions are dropped.
function cellBlobs(mask: Uint8Array, W: number, x0: number, y0: number, x1: number, y1: number, r: number, noise: number): Box[] {
  const w = x1 - x0;
  const h = y1 - y0;
  const grown = dilate(mask, W, x0, y0, w, h, r);
  const groups = components(grown, w, 0, 0, w, h);
  const out: (Box & { area: number })[] = [];
  for (const g of groups) {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, area = 0;
    for (const p of g.pixels) {
      const lx = p % w;
      const ly = (p - lx) / w;
      if (!mask[(ly + y0) * W + lx + x0]) continue;
      area++;
      if (lx < minX) minX = lx;
      if (lx > maxX) maxX = lx;
      if (ly < minY) minY = ly;
      if (ly > maxY) maxY = ly;
    }
    if (!area) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bw < noise && bh < noise) continue;
    out.push({ x: minX + x0, y: minY + y0, w: bw, h: bh, area });
  }
  out.sort((a, b) => b.area - a.area);
  return out.map(({ x, y, w, h }) => ({ x, y, w, h }));
}

// Square dilation of a window of the mask, done as two passes of a sliding-window count.
function dilate(mask: Uint8Array, W: number, x0: number, y0: number, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (y + y0) * W + x0;
    let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) count += mask[src + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += mask[src + x + r];
      if (x - r - 1 >= 0) count -= mask[src + x - r - 1];
      tmp[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) count += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) count += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

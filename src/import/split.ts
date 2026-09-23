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

export type IconFlag = "possible-merge" | "possible-split" | "auto-cut";

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

  // Rows are found from their titles when the sheet has them, since dense sheets
  // often have row gaps narrower than rowGap. Otherwise fall back to gutters (4.2).
  const titles = findTitleLines(mask, W, titleMaxH);
  const rows =
    titles.length >= 2
      ? rowsFromTitles(mask, W, H, titles, rowGap, noise)
      : rowsFromGutters(mask, W, H, rowGap, noise, titleMaxH, titleMinW);

  // 4.4 Columns: blank gutters between icons, per row.
  const rowCells = rows.map((row) => {
    const { band } = row;
    const colProfile = new Int32Array(W);
    for (let y = band.y; y < band.y + band.h; y++) {
      const o = y * W;
      for (let x = band.x; x < band.x + band.w; x++) colProfile[x] += mask[o + x];
    }
    return { colProfile, cells: runsBetweenGaps(colProfile, band.x, band.x + band.w, colGap) };
  });
  // Typical icon width across the whole sheet, so a row where every icon touches its
  // neighbour is still recognised as over-wide.
  const widths = rowCells.flatMap((r) => r.cells.map(([a, b]) => b - a)).sort((a, b) => a - b);
  const typicalW = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  // Typical distance between neighbouring icon centres, from cells of normal width.
  const steps = rowCells
    .flatMap(({ cells }) =>
      cells.slice(1).flatMap(([a, b], j) => {
        const [pa, pb] = cells[j];
        const normal = (w: number) => w <= 1.6 * typicalW;
        return normal(b - a) && normal(pb - pa) ? [(a + b) / 2 - (pa + pb) / 2] : [];
      }),
    )
    .sort((a, b) => a - b);
  const pitch = steps.length ? steps[Math.floor(steps.length / 2)] : typicalW;

  // 4.5 and 4.6 Blobs and crops within each cell.
  for (const [i, row] of rows.entries()) {
    const { band } = row;
    const { colProfile, cells } = rowCells[i];
    for (const [cx0, cx1] of cells) {
      // A cell much wider than a typical icon holds several icons with no clean gap
      // between them: cut it at the emptiest columns and flag the pieces for review.
      const wide = cx1 - cx0 > Math.max(1.6 * typicalW, 1.5 * pitch);
      for (const [x0, x1] of wide ? cutWideCell(colProfile, cx0, cx1, typicalW, pitch) : [[cx0, cx1]]) {
        const blobs = cellBlobs(mask, W, x0, band.y, x1, band.y + band.h, mergeRadius, noise);
        if (!blobs.length) continue;
        const [main, ...rest] = blobs;
        const flags: IconFlag[] = [];
        if (rest.length) flags.push("possible-split");
        if (wide) flags.push("auto-cut");
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

function profileRows(mask: Uint8Array, W: number, H: number): Int32Array {
  const rowProfile = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    const o = y * W;
    for (let x = 0; x < W; x++) n += mask[o + x];
    rowProfile[y] = n;
  }
  return rowProfile;
}

interface TitleLine extends Box {
  letters: Blob[];
}

// Title lines: runs of letter-sized marks on one text line, starting near the left
// margin, all starting at about the same x. Returned top to bottom.
export function findTitleLines(mask: Uint8Array, W: number, titleMaxH: number): TitleLine[] {
  const minLetter = Math.max(3, Math.round(titleMaxH / 5));
  const H = mask.length / W;
  const letters = components(mask, W, 0, 0, W, H)
    .filter((b) => b.h >= minLetter && b.h < titleMaxH)
    .sort((a, b) => a.x - b.x);

  // Chain letters left to right into lines: same text line, small gap between them.
  const lines: TitleLine[] = [];
  for (const b of letters) {
    const line = lines.find((l) => {
      if (b.x - (l.x + l.w) > titleMaxH) return false;
      const top = Math.min(l.y, b.y);
      const bottom = Math.max(l.y + l.h, b.y + b.h);
      return bottom - top < titleMaxH && Math.abs(b.y + b.h / 2 - (l.y + l.h / 2)) < titleMaxH / 2;
    });
    if (line) {
      const right = Math.max(line.x + line.w, b.x + b.w);
      const bottom = Math.max(line.y + line.h, b.y + b.h);
      line.y = Math.min(line.y, b.y);
      line.w = right - line.x;
      line.h = bottom - line.y;
      line.letters.push(b);
    } else {
      lines.push({ x: b.x, y: b.y, w: b.w, h: b.h, letters: [b] });
    }
  }

  let candidates = lines.filter((l) => l.x < W * 0.12 && l.w >= 3 * l.h);
  if (candidates.length < 2) return [];
  // Titles are set in one font, so their letters share a cap height. A line needs at
  // least two letters of that height; this rejects flat icon strokes at the margin.
  const heights = candidates.flatMap((l) => l.letters.map((b) => b.h)).sort((a, b) => a - b);
  const capH = heights[Math.floor(heights.length / 2)];
  const tol = Math.max(1, capH * 0.2);
  candidates = candidates.filter((l) => l.letters.filter((b) => Math.abs(b.h - capH) <= tol).length >= 2);
  if (candidates.length < 2) return [];
  // Titles share a left margin; keep the lines that start near the most common x.
  const xs = candidates.map((l) => l.x).sort((a, b) => a - b);
  const margin = xs[Math.floor(xs.length / 2)];
  return candidates.filter((l) => Math.abs(l.x - margin) <= titleMaxH / 2).sort((a, b) => a.y - b.y);
}

// Rows between consecutive titles. Title letters are erased from the mask first, then
// the boundary above each title is placed at the emptiest line near its top edge.
function rowsFromTitles(mask: Uint8Array, W: number, H: number, titles: TitleLine[], rowGap: number, noise: number): RowResult[] {
  for (const t of titles) for (const l of t.letters) for (const p of l.pixels) mask[p] = 0;
  const profile = profileRows(mask, W, H);

  const cuts: number[] = [titles[0].y];
  for (let i = 1; i < titles.length; i++) {
    const t = titles[i];
    const from = Math.max(titles[i - 1].y + titles[i - 1].h, t.y - 2 * t.h);
    let best = t.y;
    for (let y = t.y + t.h; y >= from; y--) {
      if (profile[y] < profile[best] || (profile[y] === profile[best] && Math.abs(y - t.y) < Math.abs(best - t.y))) best = y;
    }
    cuts.push(best);
  }
  cuts.push(H);

  const rows: RowResult[] = [];
  for (let i = 0; i < titles.length; i++) {
    const band = inkBox(mask, W, 0, cuts[i], W, cuts[i + 1]);
    if (!band || (band.h < noise && band.w < noise)) continue;
    const t = titles[i];
    const title = { x: t.x, y: t.y, w: t.w, h: t.h };
    rows.push({
      index: rows.length + 1,
      band,
      title,
      titleTouching: band.y - (title.y + title.h) < rowGap,
      icons: [],
      countMismatch: false,
    });
  }
  return rows;
}

// 4.2 and 4.3: bands of ink separated by blank gutters, each classified as a title
// strip or an icon row. Used for sheets without a consistent column of titles.
function rowsFromGutters(mask: Uint8Array, W: number, H: number, rowGap: number, noise: number, titleMaxH: number, titleMinW: number): RowResult[] {
  const rowProfile = profileRows(mask, W, H);
  const bands = runsBetweenGaps(rowProfile, 0, H, rowGap);

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

  return rows;
}

// Cut an over-wide cell into as many icons as its width suggests (k icons span about
// k pitches minus one gap), placing each cut at the column with the least ink near
// where an even split would put it.
function cutWideCell(profile: Int32Array, x0: number, x1: number, typicalW: number, pitch: number): [number, number][] {
  const k = Math.max(2, Math.round((x1 - x0 + Math.max(0, pitch - typicalW)) / pitch));
  const reach = Math.round(typicalW * 0.35);
  const out: [number, number][] = [];
  let start = x0;
  for (let j = 1; j < k; j++) {
    const target = x0 + Math.round((j * (x1 - x0)) / k);
    let best = target;
    for (let d = 1; d <= reach; d++) {
      for (const x of [target - d, target + d]) {
        if (x > start && x < x1 && profile[x] < profile[best]) best = x;
      }
    }
    out.push([start, best]);
    start = best;
  }
  out.push([start, x1]);
  return out;
}

// Ink lookups for the review tools: where the ink sits inside a box, and how much
// padding a crop gets at this sheet's scale.
export type Facing = "left" | "right" | "none";

export interface Ink {
  width: number;
  height: number;
  pad: number;
  inkWithin(b: Box): Box | null;
  facing(b: Box): Facing;
}

// Spec 6: guess which way an icon faces. Only a clearly lopsided icon gets a direction:
// it must look unlike its mirror image AND carry noticeably more ink on one side (heads
// and forequarters are usually the heavier end). Anything less certain is "none".
function guessFacing(mask: Uint8Array, W: number, b: Box): Facing {
  let n = 0, both = 0, sumX = 0;
  for (let y = b.y; y < b.y + b.h; y++) {
    const o = y * W;
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!mask[o + x]) continue;
      n++;
      sumX += x - b.x;
      if (mask[o + b.x + b.w - 1 - (x - b.x)]) both++;
    }
  }
  if (!n) return "none";
  const mirrorMatch = both / (2 * n - both);
  const offset = sumX / n / b.w - 0.5;
  if (mirrorMatch >= 0.5 || Math.abs(offset) < 0.04) return "none";
  return offset > 0 ? "right" : "left";
}

export function makeInk(img: ImageLike, settings: SplitSettings): Ink {
  const mask = inkMask(img, settings.threshold);
  const { width: W, height: H } = img;
  return {
    width: W,
    height: H,
    pad: Math.max(1, Math.round((settings.padding * W) / REFERENCE_WIDTH)),
    inkWithin(b) {
      const x0 = Math.max(0, Math.round(b.x));
      const y0 = Math.max(0, Math.round(b.y));
      const x1 = Math.min(W, Math.round(b.x + b.w));
      const y1 = Math.min(H, Math.round(b.y + b.h));
      return x1 > x0 && y1 > y0 ? inkBox(mask, W, x0, y0, x1, y1) : null;
    },
    facing(b) {
      const i = this.inkWithin(b);
      return i ? guessFacing(mask, W, i) : "none";
    },
  };
}

export function iconId(sheetId: string, icon: { row: number; col: number }): string {
  return `${sheetId}-r${icon.row}-c${icon.col}`;
}

// 4.1 Ink mask: 1 where the pixel is dark enough to be ink, 0 for background.
export function inkMask(img: ImageLike, threshold: number): Uint8Array {
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

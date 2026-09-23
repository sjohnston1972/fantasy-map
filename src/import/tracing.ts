// Browser side of tracing: loads potrace and keeps the traced PNG and SVG for each icon.
//
// Potrace is GPL-2.0 licensed. It is served as its own unmodified file
// (potrace/potrace.js, with its licence and source link beside it) and loaded at run
// time, rather than bundled into this page's code. See docs/open-questions.md.

import type { Box, ImageLike } from "./split";
import { traceIcon, type Potrace, type TraceSettings } from "./trace";

let potraceReady: Promise<Potrace> | null = null;

export function loadPotrace(): Promise<Potrace> {
  potraceReady ??= (async () => {
    const url = new URL("potrace/potrace.js", location.href).href;
    const mod = (await import(url)) as { potrace: Potrace; init: () => Promise<void> };
    await mod.init();
    return mod.potrace;
  })();
  return potraceReady;
}

export interface TraceEntry {
  sig: string; // box and settings it was traced with; a mismatch means it is out of date
  width: number;
  height: number;
  nodes: number;
  svg: string;
  svgUrl: string;
  png: Blob;
  pngUrl: string;
}

export function traceSig(box: Box, s: TraceSettings): string {
  return `${box.x},${box.y},${box.w},${box.h}|${s.turdsize}|${s.alphamax}|${s.opttolerance}|${s.upscale}|${s.level}`;
}

export async function traceToEntry(img: ImageLike, box: Box, s: TraceSettings): Promise<TraceEntry> {
  const t = await traceIcon(img, box, s, await loadPotrace());
  const canvas = new OffscreenCanvas(t.width, t.height);
  canvas.getContext("2d")!.putImageData(new ImageData(t.png, t.width, t.height), 0, 0);
  const png = await canvas.convertToBlob({ type: "image/png" });
  return {
    sig: traceSig(box, s),
    width: t.width,
    height: t.height,
    nodes: t.nodes,
    svg: t.svg,
    svgUrl: URL.createObjectURL(new Blob([t.svg], { type: "image/svg+xml" })),
    png,
    pngUrl: URL.createObjectURL(png),
  };
}

export function releaseEntry(e: TraceEntry) {
  URL.revokeObjectURL(e.svgUrl);
  URL.revokeObjectURL(e.pngUrl);
}

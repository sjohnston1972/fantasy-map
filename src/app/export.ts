// Export in the browser (spec: "Export as SVG and as PNG at screen and 300 dpi A3 sizes").
// The SVG file carries its typeface inside it, so it looks the same on a machine that has
// never seen IM Fell. PNG is drawn from that same SVG onto a canvas at the chosen size.

// The self-hosted typeface files, copied into public/fonts by the build.
const FONTS = [
  { file: "im-fell-english-latin-400-normal.woff2", family: "IM Fell English", style: "normal" },
  { file: "im-fell-english-latin-400-italic.woff2", family: "IM Fell English", style: "italic" },
];

let fontCss: Promise<string> | null = null;

// @font-face rules with the font files written in as base64, fetched once per visit.
export function embeddedFontCss(): Promise<string> {
  fontCss ??= Promise.all(
    FONTS.map(async (f) => {
      const bytes = new Uint8Array(await (await fetch(`/fonts/${f.file}`)).arrayBuffer());
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:400;src:url(data:font/woff2;base64,${toBase64(bytes)}) format('woff2');}`;
    }),
  )
    .then((rules) => rules.join(""))
    .catch((err) => {
      fontCss = null; // try again next time
      throw err;
    });
  return fontCss;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Pixel sizes for PNG export. A3 is 297 by 420 mm; at 300 dots per inch that is 3508 by
// 4961 pixels. Screen size is the map's own drawing size.
export function pngSize(kind: "screen" | "a3", width: number, height: number): [number, number] {
  if (kind === "screen") return [width, height];
  return width <= height ? [3508, 4961] : [4961, 3508];
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Draw an SVG (with its fonts embedded) onto a canvas of the given size and save it in
// the given image format.
async function svgToImage(svg: string, width: number, height: number, type: "image/png" | "image/jpeg", quality?: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not make a drawing surface that large.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
    if (!blob) throw new Error("This browser could not make an image that large.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const svgToPng = (svg: string, width: number, height: number) => svgToImage(svg, width, height, "image/png");

// Small JPEG preview for the gallery: at most 360 by 680 pixels (the server accepts up to
// 480 by 700).
export function thumbSize(mapWidth: number, mapHeight: number): [number, number] {
  const k = Math.min(360 / mapWidth, 680 / mapHeight);
  return [Math.max(1, Math.round(mapWidth * k)), Math.max(1, Math.round(mapHeight * k))];
}
export async function svgToThumb(svg: string, mapWidth: number, mapHeight: number): Promise<Blob> {
  const [w, h] = thumbSize(mapWidth, mapHeight);
  return svgToImage(svg, w, h, "image/jpeg", 0.8);
}

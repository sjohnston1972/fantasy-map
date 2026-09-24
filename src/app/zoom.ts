// Zoom and pan for the map view. The map is SVG, so zooming changes the SVG's viewBox (the
// window onto the drawing) rather than stretching a picture: the ink stays sharp at every
// zoom level, and editing and export are unaffected. The view is kept in map pixels.
//
// Ways in: the + and - buttons, the mouse wheel or a trackpad pinch over the map, a
// two-finger pinch on a touch screen, double-click (outside edit mode), and the + - 0 keys.
// Once zoomed in, drag the map (or use the arrow keys) to look around.
//
// Speed: redrawing a whole map takes the browser longer than one frame, so during a drag,
// pinch or wheel spin the picture already drawn is only shifted and scaled (`preview`, which
// the graphics card does cheaply), and the map is redrawn sharp once the gesture ends
// (`commit`), like a network device batching updates instead of sending one per change.

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_ZOOM = 8;

export const fullView = (W: number, H: number): View => ({ x: 0, y: 0, w: W, h: H });
export const zoomLevel = (v: View, W: number) => W / v.w;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Keep the view inside the map, between 1x and MAX_ZOOM, with the map's own shape.
export function clampView(v: View, W: number, H: number): View {
  const w = clamp(v.w, W / MAX_ZOOM, W);
  const h = (w * H) / W;
  return { x: clamp(v.x, 0, W - w), y: clamp(v.y, 0, H - h), w, h };
}

// Zoom by `factor` (2 = twice as close) keeping the map point (mx, my) where it is on screen.
export function zoomAt(v: View, W: number, H: number, factor: number, mx: number, my: number): View {
  const w = clamp(v.w / factor, W / MAX_ZOOM, W);
  const h = (w * H) / W;
  const fx = (mx - v.x) / v.w;
  const fy = (my - v.y) / v.h;
  return clampView({ x: mx - fx * w, y: my - fy * h, w, h }, W, H);
}

export function panBy(v: View, W: number, H: number, dx: number, dy: number): View {
  return clampView({ ...v, x: v.x + dx, y: v.y + dy }, W, H);
}

interface Point {
  x: number;
  y: number;
}

// How to show a view that is still moving, relative to the view last drawn: a CSS
// transform (origin top-left) that scales by `k` and shifts by (tx, ty) screen pixels.
export function previewTransform(drawn: View, live: View, boxW: number, boxH: number): { k: number; tx: number; ty: number } {
  return { k: drawn.w / live.w, tx: ((drawn.x - live.x) / drawn.w) * boxW, ty: ((drawn.y - live.y) / drawn.h) * boxH };
}

// Pointer and wheel handling for one map element. `preview` shows a view mid-gesture (fast);
// `commit` draws it properly.
export class MapZoom {
  view: View = fullView(1, 1);
  drawn: View = fullView(1, 1); // the view the map was last drawn at
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private W = 1;
  private H = 1;
  private pointers = new Map<number, Point>();
  private last: { mid: Point; dist: number } | null = null;

  constructor(
    private el: HTMLElement,
    private commitView: (v: View) => void,
    private preview: (drawn: View, live: View) => void,
  ) {}

  reset(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.set(fullView(W, H));
  }

  get level(): number {
    return zoomLevel(this.view, this.W);
  }

  // Draw a view now (buttons, keys, the end of a gesture).
  set(v: View) {
    clearTimeout(this.settleTimer);
    this.view = clampView(v, this.W, this.H);
    this.drawn = this.view;
    this.commitView(this.view);
  }

  // Show a view that is still moving; it is drawn properly once things settle.
  private glide(v: View, settleAfter?: number) {
    this.view = clampView(v, this.W, this.H);
    this.preview(this.drawn, this.view);
    clearTimeout(this.settleTimer);
    if (settleAfter !== undefined) this.settleTimer = setTimeout(() => this.set(this.view), settleAfter);
  }

  // Map pixels per screen pixel at the current zoom.
  private perPixel(): number {
    return this.view.w / this.el.getBoundingClientRect().width;
  }

  // Screen point to map point.
  toMap(clientX: number, clientY: number): Point {
    const r = this.el.getBoundingClientRect();
    return { x: this.view.x + ((clientX - r.left) / r.width) * this.view.w, y: this.view.y + ((clientY - r.top) / r.height) * this.view.h };
  }

  zoomBy(factor: number, at?: Point, moving = false) {
    const p = at ?? { x: this.view.x + this.view.w / 2, y: this.view.y + this.view.h / 2 };
    const v = zoomAt(this.view, this.W, this.H, factor, p.x, p.y);
    if (moving) this.glide(v);
    else this.set(v);
  }

  pan(dxScreen: number, dyScreen: number, moving = false) {
    const k = this.perPixel();
    const v = panBy(this.view, this.W, this.H, dxScreen * k, dyScreen * k);
    if (moving) this.glide(v);
    else this.set(v);
  }

  wheel(e: WheelEvent) {
    e.preventDefault();
    // Mouse wheels send big steps, trackpad pinches small ones; both feel right this way.
    const lines = e.deltaMode === 1 ? 16 : 1;
    const p = this.toMap(e.clientX, e.clientY);
    // Redraw sharp a moment after the wheel stops.
    this.glide(zoomAt(this.view, this.W, this.H, Math.exp(-e.deltaY * lines * 0.0018), p.x, p.y), 180);
  }

  // A pointer went down somewhere the editor did not claim. Returns true if zoom will use
  // it: a second finger always (pinch), a single one only when zoomed in (pan).
  down(e: PointerEvent): boolean {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1 && this.level <= 1.0001) {
      this.pointers.clear();
      return false;
    }
    this.last = this.gesture();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // The pointer has already gone.
    }
    return true;
  }

  // Count a pointer that went down on an item, so a second finger can still pinch.
  track(e: PointerEvent) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  get pinching(): boolean {
    return this.pointers.size >= 2;
  }

  move(e: PointerEvent): boolean {
    if (!this.pointers.has(e.pointerId) || !this.last) return false;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = this.gesture();
    if (now.dist && this.last.dist) this.zoomBy(now.dist / this.last.dist, this.toMap(this.last.mid.x, this.last.mid.y), true);
    this.pan(this.last.mid.x - now.mid.x, this.last.mid.y - now.mid.y, true);
    this.last = now;
    return true;
  }

  up(e: PointerEvent) {
    const was = this.pointers.size;
    this.pointers.delete(e.pointerId);
    this.last = this.pointers.size ? this.gesture() : null;
    // Last finger lifted: draw the view it ended on.
    if (was && !this.pointers.size && this.view !== this.drawn) this.set(this.view);
  }

  // Midpoint of the pointers and, for two or more, the spread between the first two.
  private gesture(): { mid: Point; dist: number } {
    const pts = [...this.pointers.values()];
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { mid, dist };
  }
}

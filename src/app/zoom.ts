// Zoom and pan for the map view. The map is SVG, so zooming changes the SVG's viewBox (the
// window onto the drawing) rather than stretching a picture: the ink stays sharp at every
// zoom level, and editing and export are unaffected. The view is kept in map pixels.
//
// Ways in: the + and - buttons, the mouse wheel or a trackpad pinch over the map, a
// two-finger pinch on a touch screen, double-click (outside edit mode), and the + - 0 keys.
// Once zoomed in, drag the map (or use the arrow keys) to look around.

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

// Pointer and wheel handling for one map element. `size` gives the map's size (or null
// before one is drawn); `changed` is told whenever the view moves.
export class MapZoom {
  view: View = fullView(1, 1);
  private W = 1;
  private H = 1;
  private pointers = new Map<number, Point>();
  private last: { mid: Point; dist: number } | null = null;

  constructor(
    private el: HTMLElement,
    private changed: (v: View) => void,
  ) {}

  reset(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.set(fullView(W, H));
  }

  get level(): number {
    return zoomLevel(this.view, this.W);
  }

  set(v: View) {
    this.view = clampView(v, this.W, this.H);
    this.changed(this.view);
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

  zoomBy(factor: number, at?: Point) {
    const p = at ?? { x: this.view.x + this.view.w / 2, y: this.view.y + this.view.h / 2 };
    this.set(zoomAt(this.view, this.W, this.H, factor, p.x, p.y));
  }

  pan(dxScreen: number, dyScreen: number) {
    const k = this.perPixel();
    this.set(panBy(this.view, this.W, this.H, dxScreen * k, dyScreen * k));
  }

  wheel(e: WheelEvent) {
    e.preventDefault();
    // Mouse wheels send big steps, trackpad pinches small ones; both feel right this way.
    const lines = e.deltaMode === 1 ? 16 : 1;
    this.zoomBy(Math.exp(-e.deltaY * lines * 0.0018), this.toMap(e.clientX, e.clientY));
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
    if (now.dist && this.last.dist) this.zoomBy(now.dist / this.last.dist, this.toMap(this.last.mid.x, this.last.mid.y));
    this.pan(this.last.mid.x - now.mid.x, this.last.mid.y - now.mid.y);
    this.last = now;
    return true;
  }

  up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.last = this.pointers.size ? this.gesture() : null;
  }

  // Midpoint of the pointers and, for two or more, the spread between the first two.
  private gesture(): { mid: Point; dist: number } {
    const pts = [...this.pointers.values()];
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { mid, dist };
  }
}

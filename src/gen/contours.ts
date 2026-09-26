// Outlines of areas on the grid (coastlines, lake shores), as smooth closed lines for the
// SVG renderer. Marching squares finds the edge between "inside" and "outside" cells; the
// edge pieces are joined into loops and softened so they do not show the grid.

export type Pt = [number, number];
type Side = "top" | "right" | "bottom" | "left";

// Closed outlines of the cells where `inside(i)` is true, in grid units (a cell is 1 by 1,
// its centre at c + 0.5). Loops are returned with the inside on the left.
// `soft`: instead of crossing each cell side at its midpoint, which keeps outlines to the
// grid's right angles and 45-degree steps, cross where a blurred copy of the area passes
// one half. A staircase then becomes a line at its true slope and corners round off, while
// every cell stays on the side it was on (no island or channel is lost or joined).
export function outlines(cols: number, rows: number, inside: (i: number) => boolean, soft = false): Pt[][] {
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? false : inside(r * cols + c));
  const level = soft ? softField(cols, rows, at) : null;
  const f = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : level![r * cols + c]);
  // Where the outline crosses between two neighbouring cell centres: 0 at the first, 1 at the second.
  const cross = (c0: number, r0: number, c1: number, r1: number) => {
    if (!level) return 0.5;
    const a = f(c0, r0);
    const b = f(c1, r1);
    return (a - 0.5) / (a - b);
  };
  // Each edge piece runs between the sides of a 2 by 2 block of cell centres. Pieces join at
  // the sides they share, so points are keyed by the side's midpoint, even when a soft
  // outline crosses the side somewhere else.
  const next = new Map<string, string>();
  const pts = new Map<string, Pt>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      // Block corners (cell centres): tl, tr, br, bl.
      const tl = at(c, r);
      const tr = at(c + 1, r);
      const br = at(c + 1, r + 1);
      const bl = at(c, r + 1);
      if (tl === tr && tr === br && br === bl) continue;
      const x = c + 0.5;
      const y = r + 0.5;
      // The block's sides, and where the outline crosses each. Only sides with one end
      // inside are used, so a soft crossing always falls between those two cell centres.
      const side = (s: Side): [string, Pt] =>
        s === "top"
          ? [key(x + 0.5, y), [x + cross(c, r, c + 1, r), y]]
          : s === "right"
            ? [key(x + 1, y + 0.5), [x + 1, y + cross(c + 1, r, c + 1, r + 1)]]
            : s === "bottom"
              ? [key(x + 0.5, y + 1), [x + cross(c, r + 1, c + 1, r + 1), y + 1]]
              : [key(x, y + 0.5), [x, y + cross(c, r, c, r + 1)]];
      const link = (from: Side, to: Side) => {
        const [ka, a] = side(from);
        const [kb, b] = side(to);
        pts.set(ka, a);
        pts.set(kb, b);
        next.set(ka, kb);
      };
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      // Directions keep the inside on the left of each piece.
      switch (code) {
        case 1: link("left", "bottom"); break;
        case 2: link("bottom", "right"); break;
        case 3: link("left", "right"); break;
        case 4: link("right", "top"); break;
        case 5: link("left", "top"); link("right", "bottom"); break;
        case 6: link("bottom", "top"); break;
        case 7: link("left", "top"); break;
        case 8: link("top", "left"); break;
        case 9: link("top", "bottom"); break;
        case 10: link("top", "right"); link("bottom", "left"); break;
        case 11: link("top", "right"); break;
        case 12: link("right", "left"); break;
        case 13: link("right", "bottom"); break;
        case 14: link("bottom", "left"); break;
        default: break;
      }
    }
  }
  // Join pieces into loops.
  const loops: Pt[][] = [];
  const used = new Set<string>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: Pt[] = [];
    let k: string | undefined = start;
    while (k && !used.has(k)) {
      used.add(k);
      loop.push(pts.get(k)!);
      k = next.get(k);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// The area blurred (two passes of a 3 by 3 average), then held to its own side of one half:
// at least 0.55 inside it and at most 0.45 outside, so the outline never moves past a cell centre.
function softField(cols: number, rows: number, at: (c: number, r: number) => boolean): Float32Array {
  let a = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) a[r * cols + c] = at(c, r) ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            const rr = r + dr;
            if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) sum += a[rr * cols + cc];
          }
        b[r * cols + c] = sum / 9;
      }
    a = b;
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      a[i] = at(c, r) ? Math.max(0.55, a[i]) : Math.min(0.45, a[i]);
    }
  return a;
}

// Chaikin corner cutting on a closed loop, repeated `passes` times.
export function smoothLoop(loop: Pt[], passes = 2): Pt[] {
  let p = loop;
  for (let k = 0; k < passes; k++) {
    const out: Pt[] = [];
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i];
      const [bx, by] = p[(i + 1) % p.length];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    p = out;
  }
  return p;
}

// Shoelace area; positive when the loop runs anticlockwise on screen.
export function loopArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % loop.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Drop points that change the line by less than `tol` (Ramer-Douglas-Peucker), so smoothed
// outlines keep their shape with a fraction of the points. Works on open lines; for loops,
// pass the loop and it is treated as open between its first and last points.
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1;
    let worst = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > worst) {
        worst = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

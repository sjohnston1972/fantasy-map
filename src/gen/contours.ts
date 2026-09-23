// Outlines of areas on the grid (coastlines, lake shores), as smooth closed lines for the
// SVG renderer. Marching squares finds the edge between "inside" and "outside" cells; the
// edge pieces are joined into loops and softened so they do not show the grid.

export type Pt = [number, number];

// Closed outlines of the cells where `inside(i)` is true, in grid units (a cell is 1 by 1,
// its centre at c + 0.5). Loops are returned with the inside on the left.
export function outlines(cols: number, rows: number, inside: (i: number) => boolean): Pt[][] {
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? false : inside(r * cols + c));
  // Each edge piece runs between midpoints of the sides of a 2 by 2 block of cell centres.
  const next = new Map<string, string>();
  const pts = new Map<string, Pt>();
  const key = (x: number, y: number) => `${x},${y}`;
  const link = (a: Pt, b: Pt) => {
    const ka = key(a[0], a[1]);
    pts.set(ka, a);
    pts.set(key(b[0], b[1]), b);
    next.set(ka, key(b[0], b[1]));
  };
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      // Block corners (cell centres): tl, tr, br, bl.
      const tl = at(c, r);
      const tr = at(c + 1, r);
      const br = at(c + 1, r + 1);
      const bl = at(c, r + 1);
      const x = c + 0.5;
      const y = r + 0.5;
      const top: Pt = [x + 0.5, y];
      const right: Pt = [x + 1, y + 0.5];
      const bottom: Pt = [x + 0.5, y + 1];
      const left: Pt = [x, y + 0.5];
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      // Directions keep the inside on the left of each piece.
      switch (code) {
        case 1: link(left, bottom); break;
        case 2: link(bottom, right); break;
        case 3: link(left, right); break;
        case 4: link(right, top); break;
        case 5: link(left, top); link(right, bottom); break;
        case 6: link(bottom, top); break;
        case 7: link(left, top); break;
        case 8: link(top, left); break;
        case 9: link(top, bottom); break;
        case 10: link(top, right); link(bottom, left); break;
        case 11: link(top, right); break;
        case 12: link(right, left); break;
        case 13: link(right, bottom); break;
        case 14: link(bottom, left); break;
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

// Ribbon: four arms from the knot down each side, plus a bow. Each piece is a strip of
// particles three wide. While tied, the knot ends are pinned and every particle is held to its
// rest shape (firmly for the arms, loosely for the bow so it wobbles). Untying lets it all go.

import { Cloth, ClothBuilder } from './cloth';
import { GIFT, RIBBON_OFFSET, TOP } from './dims';

export const RIBBON_WIDTHS = [0.1, 0.15, 0.21];

export interface Ribbon {
  cloth: Cloth;
  index: Uint32Array;
  uv: Float32Array;
  knot: [number, number, number];
  /** Particles from here on belong to the bow. */
  bowStart: number;
  /** Particles pinned at the knot while tied. */
  knotPins: number[];
}

type V = [number, number, number];
const SPACING = 0.055;
const ARM_HOLD = 0.6;
const BOW_HOLD = 0.12;

export function buildRibbon(bow: number, width: number): Ribbon {
  const w = RIBBON_WIDTHS[width] ?? RIBBON_WIDTHS[1];
  const b = new ClothBuilder();
  const index: number[] = [];
  const uv: number[] = [];
  const knotPins: number[] = [];
  const T = TOP + RIBBON_OFFSET;
  const knot: V = [0, T + 0.03, 0];

  const strip = (path: V[], side: V, opts: { pinStart: boolean; pinEnd: boolean; hold: number; gravity: number }) => {
    const pts = resample(path, SPACING);
    const rows: number[][] = [];
    pts.forEach((p, r) => {
      const row: number[] = [];
      for (let c = 0; c < 3; c++) {
        const o = (c - 1) * (w / 2);
        const id = b.add(p[0] + side[0] * o, p[1] + side[1] * o, p[2] + side[2] * o, 1, opts.gravity);
        const pinned = (opts.pinStart && r === 0) || (opts.pinEnd && r === pts.length - 1);
        if (pinned) knotPins.push(id);
        b.anchor(id, pinned ? 1 : opts.hold);
        uv.push(c / 2, r * SPACING);
        row.push(id);
      }
      rows.push(row);
    });
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < 3; c++) {
        if (c < 2) b.spring(rows[r][c], rows[r][c + 1], 0);
        if (r + 1 < rows.length) {
          b.spring(rows[r][c], rows[r + 1][c], 0);
          if (c < 2) {
            b.spring(rows[r][c], rows[r + 1][c + 1], 1e-7);
            b.spring(rows[r][c + 1], rows[r + 1][c], 1e-7);
            index.push(rows[r][c], rows[r + 1][c], rows[r + 1][c + 1], rows[r][c], rows[r + 1][c + 1], rows[r][c + 1]);
          }
        }
        if (r + 2 < rows.length) b.spring(rows[r][c], rows[r + 2][c], 4e-6);
      }
    }
  };

  // Arms: knot -> edge -> down the side.
  const e = GIFT.hx + RIBBON_OFFSET;
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const path: V[] = [[0, T, 0]];
    const R = 0.05;
    path.push([d[0] * (e - R), T, d[1] * (e - R)]);
    for (let a = 1; a <= 4; a++) {
      const t = (a / 4) * (Math.PI / 2);
      path.push([d[0] * (e - R + Math.sin(t) * R), T - R + Math.cos(t) * R, d[1] * (e - R + Math.sin(t) * R)]);
    }
    path.push([d[0] * e, 0.03, d[1] * e]);
    strip(path, [-d[1], 0, d[0]], { pinStart: true, pinEnd: false, hold: ARM_HOLD, gravity: 1 });
  }

  const bowStart = b.invMass.length;
  const loop = (deg: number, L: number, h: number, k: number) => {
    const a = (deg * Math.PI) / 180;
    const d: V = [Math.cos(a), 0, Math.sin(a)];
    const path: V[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const s = Math.sin(Math.PI * t);
      const up = h * s + k * Math.sin(2 * Math.PI * t);
      path.push([knot[0] + d[0] * L * s, knot[1] + up, knot[2] + d[2] * L * s]);
    }
    strip(path, [-d[2], 0, d[0]], { pinStart: true, pinEnd: true, hold: BOW_HOLD, gravity: 0.6 });
  };
  const tail = (deg: number, L: number) => {
    const a = (deg * Math.PI) / 180;
    const d: V = [Math.cos(a), 0, Math.sin(a)];
    const path: V[] = [];
    for (let i = 0; i <= 10; i++) {
      const s = (i / 10) * L;
      path.push([knot[0] + d[0] * s, knot[1] - 0.012 - s * 0.02, knot[2] + d[2] * s]);
    }
    strip(path, [-d[2], 0, d[0]], { pinStart: true, pinEnd: false, hold: BOW_HOLD, gravity: 0.6 });
  };

  if (bow === 1) {
    for (let i = 0; i < 6; i++) loop(i * 60 + 15, 0.36, 0.24, 0.12);
  } else if (bow === 2) {
    tail(35, 0.95);
    tail(215, 0.95);
    loop(125, 0.22, 0.12, 0.06);
    loop(305, 0.22, 0.12, 0.06);
  } else {
    loop(10, 0.5, 0.34, 0.2);
    loop(190, 0.5, 0.34, 0.2);
    tail(-55, 0.75);
    tail(235, 0.75);
  }

  const cloth = new Cloth(b);
  for (const id of knotPins) cloth.w[id] = 0;
  cloth.radius = 0.016;
  cloth.damping = 0.985;
  cloth.iterations = 1;
  cloth.grabCap = 0.05;
  return { cloth, index: Uint32Array.from(index), uv: Float32Array.from(uv), knot, bowStart, knotPins };
}

function resample(path: V[], ds: number): V[] {
  const out: V[] = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let s = ds - carry;
    while (s <= len) {
      const t = s / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      s += ds;
    }
    carry = len - (s - ds);
  }
  const last = path[path.length - 1];
  const end = out[out.length - 1];
  if (Math.hypot(last[0] - end[0], last[1] - end[1], last[2] - end[2]) > ds * 0.3) out.push(last);
  return out;
}

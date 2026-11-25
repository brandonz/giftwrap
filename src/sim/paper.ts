// Wrapping paper: a grid over each face of the gift, cut into irregular shards. Inside a shard
// the paper is held by stretch and bend springs; neighbouring shards are joined by seams that
// break under strain. The mesh never changes at runtime; tears are seams letting go.

import { Cloth, ClothBuilder } from './cloth';
import { GIFT, PAPER_OFFSET } from './dims';
import { rng } from './rng';

export interface PaperParams {
  /** Cells across a 2-unit face. */
  cells: number;
  shards: number;
  glue: number;
  seed: number;
}

export interface Paper {
  cloth: Cloth;
  /** Triangles, outward-wound. */
  index: Uint32Array;
  /** Per-vertex UV in metres across the face (the pattern repeats on top of this). */
  uv: Float32Array;
  shardOf: Uint16Array;
  shardCount: number;
  /** Particles glued to the box once the ribbon is off. */
  glued: Uint8Array;
  /** A hand-sized grab, at least a cell and a half across so coarse meshes still tear. */
  grabRadius: number;
}

const STRETCH = 1e-8;
const BEND = 2e-5;
export const GLUE_K = 0.5;
export const GLUE_BREAK = 0.05;

export function buildPaper(p: PaperParams): Paper {
  const rnd = rng(p.seed);
  const H = [GIFT.hx + PAPER_OFFSET, GIFT.hy + PAPER_OFFSET, GIFT.hz + PAPER_OFFSET];
  const cy = GIFT.cy;
  const cell = 2 / p.cells;

  // Shard seeds scattered over the surface.
  const seeds: number[][] = [];
  for (let s = 0; s < p.shards; s++) seeds.push(randomSurfacePoint(rnd, H));

  const b = new ClothBuilder();
  const uv: number[] = [];
  const shardOf: number[] = [];
  const faceOf: number[] = [];
  const index: number[] = [];
  const vmap = new Map<string, number>();
  const byPos = new Map<string, number[]>();

  const faces: [number, number][] = [
    [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1],
  ];
  faces.forEach(([ax, sign], face) => {
    // No paper under the box: nobody sees it, and it would fight the ground.
    if (ax === 1 && sign < 0) return;
    const u = (ax + 1) % 3;
    const v = (ax + 2) % 3;
    const nu = Math.max(2, Math.round((2 * H[u]) / cell));
    const nv = Math.max(2, Math.round((2 * H[v]) / cell));
    const at = (i: number, j: number) => {
      const q = [0, 0, 0];
      q[ax] = sign * H[ax];
      q[u] = (i / nu) * 2 * H[u] - H[u];
      q[v] = (j / nv) * 2 * H[v] - H[v];
      return q;
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        for (const t of [[0, 1, 2], [0, 2, 3]]) {
          const tri = t.map((k) => quad[k]);
          const c = [0, 1, 2].map((k) => (tri[0][k] + tri[1][k] + tri[2][k]) / 3 + (rnd() - 0.5) * 0.08);
          let shard = 0;
          let best = Infinity;
          seeds.forEach((s, si) => {
            const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2;
            if (d < best) {
              best = d;
              shard = si;
            }
          });
          const ids = tri.map((q) => {
            const pk = q.map((x) => Math.round(x * 1e4)).join(',');
            const key = `${pk}|${shard}|${face}`;
            let id = vmap.get(key);
            if (id === undefined) {
              id = b.add(q[0], q[1] + cy, q[2]);
              vmap.set(key, id);
              uv.push(q[u] + H[u], q[v] + H[v]);
              shardOf.push(shard);
              faceOf.push(face);
              let list = byPos.get(pk);
              if (!list) byPos.set(pk, (list = []));
              list.push(id);
            }
            return id;
          });
          // Outward winding: the normal must point away from the gift's centre.
          const [a, bb, cc] = ids.map((id) => [b.pos[3 * id], b.pos[3 * id + 1] - cy, b.pos[3 * id + 2]]);
          const n = cross(sub(bb, a), sub(cc, a));
          const mid = [(a[0] + bb[0] + cc[0]) / 3, (a[1] + bb[1] + cc[1]) / 3, (a[2] + bb[2] + cc[2]) / 3];
          if (dot(n, mid) < 0) index.push(ids[0], ids[2], ids[1]);
          else index.push(ids[0], ids[1], ids[2]);
        }
      }
    }
  });

  // Stretch springs on triangle edges, bend springs across each shared edge.
  const edges = new Map<string, number[]>();
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k];
      const c = index[t + ((k + 1) % 3)];
      const o = index[t + ((k + 2) % 3)];
      const key = a < c ? `${a},${c}` : `${c},${a}`;
      let l = edges.get(key);
      if (!l) edges.set(key, (l = []));
      l.push(o);
    }
  }
  for (const [key, opp] of edges) {
    const [a, c] = key.split(',').map(Number);
    b.spring(a, c, STRETCH);
    if (opp.length === 2) b.spring(opp[0], opp[1], BEND);
  }

  // Coincident vertices: same shard across a box edge = welded for good; different shards = seam.
  for (const ids of byPos.values()) {
    for (let i = 1; i < ids.length; i++) {
      for (let j = 0; j < i; j++) {
        if (shardOf[ids[i]] === shardOf[ids[j]]) b.spring(ids[i], ids[j], 0);
        else b.seam(ids[i], ids[j]);
      }
    }
  }

  const glued = new Uint8Array(shardOf.length);
  for (let i = 0; i < shardOf.length; i++) {
    // The bottom edge is tucked under the box, so it is always glued.
    if (rnd() < p.glue || b.pos[3 * i + 1] < 0.03) {
      glued[i] = 1;
      b.anchor(i, GLUE_K, GLUE_BREAK);
    }
  }

  const cloth = new Cloth(b);
  cloth.radius = 0.006;
  cloth.iterations = 3;
  cloth.seamBreak = 0.035;
  cloth.grabCap = 0.03;
  return {
    cloth,
    index: Uint32Array.from(index),
    uv: Float32Array.from(uv),
    shardOf: Uint16Array.from(shardOf),
    shardCount: p.shards,
    glued,
    grabRadius: Math.max(0.25, cell * 1.35),
  };
}

function randomSurfacePoint(rnd: () => number, H: number[]): number[] {
  // Pick a face weighted by area, then a point on it.
  // Face order: +x, -x, +y, -y (no paper), +z, -z.
  const areas = [H[1] * H[2], H[1] * H[2], H[2] * H[0], 0, H[0] * H[1], H[0] * H[1]];
  let r = rnd() * areas.reduce((a, b) => a + b, 0);
  let f = 0;
  while (r > areas[f]) r -= areas[f++];
  const ax = f >> 1;
  const q = [(rnd() * 2 - 1) * H[0], (rnd() * 2 - 1) * H[1], (rnd() * 2 - 1) * H[2]];
  q[ax] = (f & 1 ? -1 : 1) * H[ax];
  return q;
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

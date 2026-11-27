// Position-based particle cloth (XPBD distance constraints, small substeps, one pass each).
// Used for both the wrapping paper and the ribbon. No DOM, no three.js.

export interface Aabb {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}

/** A box open at the top: thin walls, and a floor whose top is ground like the real ground. */
export interface OpenBox {
  floor: Aabb;
  walls: Aabb[];
}

/** What particles collide with: one solid box, or an open one. */
export type Collider = Aabb | OpenBox;

export interface SphereSet {
  count: number;
  pos: Float64Array; // xyz per sphere
  radius: Float64Array;
}

export class ClothBuilder {
  pos: number[] = [];
  invMass: number[] = [];
  gravity: number[] = [];
  springs: number[] = []; // a, b, compliance triplets
  seams: number[] = []; // a, b pairs
  anchors: Map<number, { k: number; breakAt: number }> = new Map();

  add(x: number, y: number, z: number, invMass = 1, gravity = 1): number {
    this.pos.push(x, y, z);
    this.invMass.push(invMass);
    this.gravity.push(gravity);
    return this.invMass.length - 1;
  }

  spring(a: number, b: number, compliance = 0) {
    this.springs.push(a, b, compliance);
  }

  seam(a: number, b: number) {
    this.seams.push(a, b);
  }

  anchor(i: number, k: number, breakAt = Infinity) {
    this.anchors.set(i, { k, breakAt });
  }
}

export class Cloth {
  readonly n: number;
  readonly x: Float64Array;
  readonly prev: Float64Array;
  readonly v: Float64Array;
  readonly w: Float64Array;
  readonly gravity: Float64Array;
  /** Anchor (glue) target per particle, world space. */
  readonly rest: Float64Array;
  /** Fraction of the gap to the anchor closed per substep; 0 = not anchored. */
  readonly anchorK: Float64Array;
  /** Distance past which the anchor lets go. */
  readonly anchorBreak: Float64Array;

  readonly ca: Uint32Array;
  readonly cb: Uint32Array;
  readonly cr: Float64Array;
  readonly ck: Float64Array;

  readonly sa: Uint32Array;
  readonly sb: Uint32Array;
  readonly seamAlive: Uint8Array;
  seamBreak = 0.035;
  seamsLocked = false;

  radius = 0.006;
  damping = 0.992;
  groundFriction = 0.5;
  iterations = 1;

  // Grab: a patch of particles pulled toward target + offset with a capped step.
  grabIdx: number[] = [];
  grabOff: number[] = [];
  readonly grabTarget = [0, 0, 0];
  grabCap = 0.03;
  grabLeftAnchors = false;

  brokenSeams = 0;

  constructor(b: ClothBuilder) {
    this.n = b.invMass.length;
    this.x = Float64Array.from(b.pos);
    this.prev = Float64Array.from(b.pos);
    this.v = new Float64Array(this.n * 3);
    this.w = Float64Array.from(b.invMass);
    this.gravity = Float64Array.from(b.gravity);
    this.rest = Float64Array.from(b.pos);
    this.anchorK = new Float64Array(this.n);
    this.anchorBreak = new Float64Array(this.n).fill(Infinity);
    for (const [i, a] of b.anchors) {
      this.anchorK[i] = a.k;
      this.anchorBreak[i] = a.breakAt;
    }
    const m = b.springs.length / 3;
    this.ca = new Uint32Array(m);
    this.cb = new Uint32Array(m);
    this.cr = new Float64Array(m);
    this.ck = new Float64Array(m);
    for (let c = 0; c < m; c++) {
      const a = b.springs[3 * c];
      const bb = b.springs[3 * c + 1];
      this.ca[c] = a;
      this.cb[c] = bb;
      this.ck[c] = b.springs[3 * c + 2];
      this.cr[c] = this.dist(a, bb);
    }
    const s = b.seams.length / 2;
    this.sa = new Uint32Array(s);
    this.sb = new Uint32Array(s);
    for (let c = 0; c < s; c++) {
      this.sa[c] = b.seams[2 * c];
      this.sb[c] = b.seams[2 * c + 1];
    }
    this.seamAlive = new Uint8Array(s).fill(1);
  }

  dist(a: number, b: number): number {
    const x = this.x;
    return Math.hypot(x[3 * a] - x[3 * b], x[3 * a + 1] - x[3 * b + 1], x[3 * a + 2] - x[3 * b + 2]);
  }

  /** Grabs every particle within `radius` of `point`. Returns how many were taken. */
  grab(point: ArrayLike<number>, radius: number, filter?: (i: number) => boolean): number {
    this.release();
    const x = this.x;
    for (let i = 0; i < this.n; i++) {
      if (filter && !filter(i)) continue;
      const dx = x[3 * i] - point[0];
      const dy = x[3 * i + 1] - point[1];
      const dz = x[3 * i + 2] - point[2];
      if (dx * dx + dy * dy + dz * dz < radius * radius) {
        this.grabIdx.push(i);
        this.grabOff.push(dx, dy, dz);
      }
    }
    this.grabTarget[0] = point[0];
    this.grabTarget[1] = point[1];
    this.grabTarget[2] = point[2];
    return this.grabIdx.length;
  }

  release() {
    this.grabIdx.length = 0;
    this.grabOff.length = 0;
  }

  get grabbing() {
    return this.grabIdx.length > 0;
  }

  /** Mean displacement of the grabbed patch from its anchors (how hard it is being pulled). */
  grabStretch(): number {
    if (!this.grabIdx.length) return 0;
    let s = 0;
    for (const i of this.grabIdx) {
      s += Math.hypot(this.x[3 * i] - this.rest[3 * i], this.x[3 * i + 1] - this.rest[3 * i + 1], this.x[3 * i + 2] - this.rest[3 * i + 2]);
    }
    return s / this.grabIdx.length;
  }

  impulse(i: number, vx: number, vy: number, vz: number) {
    this.v[3 * i] += vx;
    this.v[3 * i + 1] += vy;
    this.v[3 * i + 2] += vz;
  }

  step(dt: number, substeps: number, box: Collider | null) {
    const h = dt / substeps;
    for (let s = 0; s < substeps; s++) this.substep(h, box);
  }

  private substep(h: number, box: Collider | null) {
    const { x, prev, v, w, gravity, n } = this;
    const damp = this.damping;
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      prev[k] = x[k];
      prev[k + 1] = x[k + 1];
      prev[k + 2] = x[k + 2];
      if (w[i] === 0) continue;
      v[k] *= damp;
      v[k + 1] = (v[k + 1] - 9.81 * gravity[i] * h) * damp;
      v[k + 2] *= damp;
      x[k] += v[k] * h;
      x[k + 1] += v[k + 1] * h;
      x[k + 2] += v[k + 2] * h;
    }

    // Grabbed patch: capped pull, so a fast flick cannot overstretch the sheet.
    const gi = this.grabIdx;
    if (gi.length) {
      const t = this.grabTarget;
      const cap = this.grabCap;
      for (let g = 0; g < gi.length; g++) {
        const k = 3 * gi[g];
        const dx = t[0] + this.grabOff[3 * g] - x[k];
        const dy = t[1] + this.grabOff[3 * g + 1] - x[k + 1];
        const dz = t[2] + this.grabOff[3 * g + 2] - x[k + 2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const m = 0.5 * Math.min(1, cap / (l + 1e-9));
        x[k] += dx * m;
        x[k + 1] += dy * m;
        x[k + 2] += dz * m;
      }
    }

    const ih2 = 1 / (h * h);
    const { ca, cb, cr, ck } = this;
    for (let it = 0; it < this.iterations; it++) {
      for (let c = 0; c < ca.length; c++) project(x, w, ca[c], cb[c], cr[c], ck[c] * ih2);
    }

    const { sa, sb, seamAlive } = this;
    const brk = this.seamsLocked ? Infinity : this.seamBreak;
    for (let c = 0; c < sa.length; c++) {
      if (!seamAlive[c]) continue;
      if (project(x, w, sa[c], sb[c], 0, 0) > brk) {
        seamAlive[c] = 0;
        this.brokenSeams++;
      }
    }

    const { rest, anchorK, anchorBreak } = this;
    for (let i = 0; i < n; i++) {
      const a = anchorK[i];
      if (a === 0) continue;
      const k = 3 * i;
      const dx = rest[k] - x[k];
      const dy = rest[k + 1] - x[k + 1];
      const dz = rest[k + 2] - x[k + 2];
      if (dx * dx + dy * dy + dz * dz > anchorBreak[i] * anchorBreak[i]) {
        anchorK[i] = 0;
        continue;
      }
      x[k] += dx * a;
      x[k + 1] += dy * a;
      x[k + 2] += dz * a;
    }

    const r = this.radius;
    const fr = this.groundFriction;
    const floor = box && 'floor' in box ? box.floor : null;
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      if (w[i] !== 0) {
        if (box) pushOutOfCollider(x, k, box, r);
        if (x[k + 1] < r) x[k + 1] = r;
      }
      const ground = x[k + 1] < r * 1.5 || (floor !== null && onTop(x, k, floor, r * 1.5));
      v[k] = ((x[k] - prev[k]) / h) * (ground ? fr : 1);
      v[k + 1] = (x[k + 1] - prev[k + 1]) / h;
      v[k + 2] = ((x[k + 2] - prev[k + 2]) / h) * (ground ? fr : 1);
    }
  }

  /** One-way contact: particles are pushed out of the spheres (ornaments are heavier). */
  collideSpheres(s: SphereSet) {
    const x = this.x;
    const r0 = this.radius;
    for (let i = 0; i < this.n; i++) {
      const k = 3 * i;
      if (this.w[i] === 0) continue;
      for (let j = 0; j < s.count; j++) {
        const R = s.radius[j] + r0;
        const dx = x[k] - s.pos[3 * j];
        const dy = x[k + 1] - s.pos[3 * j + 1];
        const dz = x[k + 2] - s.pos[3 * j + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= R * R || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const push = (R - d) / d;
        x[k] += dx * push;
        x[k + 1] += dy * push;
        x[k + 2] += dz * push;
        this.prev[k] = x[k];
        this.prev[k + 1] = x[k + 1];
        this.prev[k + 2] = x[k + 2];
        this.v[k] *= 0.5;
        this.v[k + 1] *= 0.5;
        this.v[k + 2] *= 0.5;
      }
    }
  }

  isFinite(): boolean {
    for (let k = 0; k < this.x.length; k++) if (!Number.isFinite(this.x[k]) || Math.abs(this.x[k]) > 100) return false;
    return true;
  }
}

function project(x: Float64Array, w: Float64Array, a: number, b: number, rest: number, alpha: number): number {
  const wa = w[a];
  const wb = w[b];
  const sum = wa + wb + alpha;
  if (sum === 0) return 0;
  const i = 3 * a;
  const j = 3 * b;
  const dx = x[i] - x[j];
  const dy = x[i + 1] - x[j + 1];
  const dz = x[i + 2] - x[j + 2];
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (l < 1e-12) return 0;
  const s = -(l - rest) / sum / l;
  x[i] += dx * s * wa;
  x[i + 1] += dy * s * wa;
  x[i + 2] += dz * s * wa;
  x[j] -= dx * s * wb;
  x[j + 1] -= dy * s * wb;
  x[j + 2] -= dz * s * wb;
  return l - rest;
}

/** Pushes point k out of the box (inflated by r) along the shallowest axis. */
export function pushOutOfBox(x: Float64Array, k: number, b: Aabb, r: number) {
  const px = x[k] - b.cx;
  const py = x[k + 1] - b.cy;
  const pz = x[k + 2] - b.cz;
  const dx = Math.abs(px) - b.hx - r;
  const dy = Math.abs(py) - b.hy - r;
  const dz = Math.abs(pz) - b.hz - r;
  if (dx >= 0 || dy >= 0 || dz >= 0) return;
  if (dx > dy && dx > dz) x[k] = b.cx + (px < 0 ? -1 : 1) * (b.hx + r);
  else if (dy > dz) x[k + 1] = b.cy + (py < 0 ? -1 : 1) * (b.hy + r);
  else x[k + 2] = b.cz + (pz < 0 ? -1 : 1) * (b.hz + r);
}

/** Pushes point k out of the collider: the box, or each part of the open box in turn. */
function pushOutOfCollider(x: Float64Array, k: number, c: Collider, r: number) {
  if (!('floor' in c)) {
    pushOutOfBox(x, k, c, r);
    return;
  }
  pushOutOfBox(x, k, c.floor, r);
  for (const b of c.walls) pushOutOfBox(x, k, b, r);
}

/**
 * Pushes a sphere at k away from the nearest point of the box, with the box's edges rounded by `round`
 * (at most its smallest half-size; the faces stay put). Rounded by half its thickness, a thin wall's rim
 * is a half-cylinder that a ball rolls off. A centre inside the box leaves through the nearest face.
 */
export function pushSphereOutOfBox(x: Float64Array, k: number, b: Aabb, r: number, round = 0) {
  const dx = x[k] - Math.max(b.cx - b.hx + round, Math.min(b.cx + b.hx - round, x[k]));
  const dy = x[k + 1] - Math.max(b.cy - b.hy + round, Math.min(b.cy + b.hy - round, x[k + 1]));
  const dz = x[k + 2] - Math.max(b.cz - b.hz + round, Math.min(b.cz + b.hz - round, x[k + 2]));
  const d2 = dx * dx + dy * dy + dz * dz;
  const R = r + round;
  if (d2 >= R * R) return;
  if (d2 < 1e-12) {
    pushOutOfBox(x, k, b, r);
    return;
  }
  const d = Math.sqrt(d2);
  const s = (R - d) / d;
  x[k] += dx * s;
  x[k + 1] += dy * s;
  x[k + 2] += dz * s;
}

/** Whether point k is over the box and less than h above its top. */
export function onTop(x: ArrayLike<number>, k: number, b: Aabb, h: number): boolean {
  return x[k + 1] < b.cy + b.hy + h && Math.abs(x[k] - b.cx) < b.hx && Math.abs(x[k + 2] - b.cz) < b.hz;
}

/** Signed distance from point to the box surface (negative inside). */
export function boxDistance(x: ArrayLike<number>, k: number, b: Aabb): number {
  const dx = Math.abs(x[k] - b.cx) - b.hx;
  const dy = Math.abs(x[k + 1] - b.cy) - b.hy;
  const dz = Math.abs(x[k + 2] - b.cz) - b.hz;
  const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
  return out + Math.min(Math.max(dx, dy, dz), 0);
}

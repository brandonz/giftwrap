// The lid: a rigid box that stays put until the gift opens, then pops off, spins and lands.

import { pushSphereOutOfBox, type Aabb } from './cloth';
import { BASE, LID, WALL } from './dims';

/** What ornaments hit, in the lid's own frame: a top plate and four skirt walls, open underneath. */
const SHELL: Aabb[] = shell();

function shell(): Aabb[] {
  const { hx, hy, hz } = LID;
  const t = WALL / 2;
  return [
    { cx: 0, cy: hy - t, cz: 0, hx, hy: t, hz },
    { cx: hx - t, cy: 0, cz: 0, hx: t, hy, hz },
    { cx: t - hx, cy: 0, cz: 0, hx: t, hy, hz },
    { cx: 0, cy: 0, cz: hz - t, hx, hy, hz: t },
    { cx: 0, cy: 0, cz: t - hz, hx, hy, hz: t },
  ];
}

export class Lid {
  readonly pos = [LID.cx, LID.cy, LID.cz];
  /** Quaternion x, y, z, w. */
  readonly rot = [0, 0, 0, 1];
  readonly vel = [0, 0, 0];
  readonly ang = [0, 0, 0];
  readonly half = [LID.hx, LID.hy, LID.hz];
  free = false;
  /** Scratch: a point in the lid's frame. */
  private readonly local = new Float64Array(3);
  private readonly invMass = 1 / 1.5;
  private readonly invI: number[];

  constructor() {
    const m = 1.5;
    const [a, b, c] = this.half;
    this.invI = [3 / (m * (b * b + c * c)), 3 / (m * (a * a + c * c)), 3 / (m * (a * a + b * b))];
  }

  pop(seed: number) {
    const s = Math.sin(seed * 12.9898) * 43758.5453;
    const r = s - Math.floor(s);
    const a = r * Math.PI * 2;
    this.free = true;
    this.vel[0] = Math.cos(a) * 1.6;
    this.vel[1] = 5.2;
    this.vel[2] = Math.sin(a) * 1.6;
    this.ang[0] = Math.sin(a) * 4;
    this.ang[1] = 1.5;
    this.ang[2] = -Math.cos(a) * 4;
  }

  step(dt: number) {
    if (!this.free) return;
    const sub = 4;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this.substep(h);
  }

  private substep(h: number) {
    const { pos, vel, ang, rot } = this;
    vel[1] -= 9.81 * h;
    for (let c = 0; c < 3; c++) pos[c] += vel[c] * h;
    // q += 0.5 * (w, 0) * q * h
    const [x, y, z, w] = rot;
    const [ax, ay, az] = ang;
    rot[0] += 0.5 * h * (ax * w + ay * z - az * y);
    rot[1] += 0.5 * h * (ay * w + az * x - ax * z);
    rot[2] += 0.5 * h * (az * w + ax * y - ay * x);
    rot[3] += 0.5 * h * (-ax * x - ay * y - az * z);
    const n = Math.hypot(rot[0], rot[1], rot[2], rot[3]);
    for (let c = 0; c < 4; c++) rot[c] /= n;

    // Corner contacts with the ground and the top of the base.
    for (let cxi = -1; cxi <= 1; cxi += 2)
      for (let cyi = -1; cyi <= 1; cyi += 2)
        for (let czi = -1; czi <= 1; czi += 2) {
          const r = this.rotate([cxi * this.half[0], cyi * this.half[1], czi * this.half[2]]);
          const p = [pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]];
          let depth = -p[1];
          let n = [0, 1, 0];
          // The open base: treat its top rim as a floor when the corner is above it.
          const baseTop = BASE.cy + BASE.hy;
          if (Math.abs(p[0]) < BASE.hx && Math.abs(p[2]) < BASE.hz && p[1] < baseTop && p[1] > baseTop - 0.3) {
            const d = baseTop - p[1];
            if (d > depth) {
              depth = d;
              n = [0, 1, 0];
            }
          }
          if (depth > 0) this.contact(r, n, depth);
        }
    for (let c = 0; c < 3; c++) ang[c] *= 0.995;
  }

  private contact(r: number[], n: number[], depth: number) {
    const { vel, ang, pos } = this;
    for (let c = 0; c < 3; c++) pos[c] += n[c] * depth;
    const vp = [vel[0] + ang[1] * r[2] - ang[2] * r[1], vel[1] + ang[2] * r[0] - ang[0] * r[2], vel[2] + ang[0] * r[1] - ang[1] * r[0]];
    const vn = vp[0] * n[0] + vp[1] * n[1] + vp[2] * n[2];
    if (vn >= 0) return;
    const rn = cross(r, n);
    const iw = this.applyInvInertia(rn);
    const k = this.invMass + dot(rn, iw);
    const jn = (-(1 + 0.25) * vn) / k;
    // Friction along the tangential velocity, capped by Coulomb.
    const vt = [vp[0] - vn * n[0], vp[1] - vn * n[1], vp[2] - vn * n[2]];
    const vtl = Math.hypot(vt[0], vt[1], vt[2]);
    const J = [n[0] * jn, n[1] * jn, n[2] * jn];
    if (vtl > 1e-6) {
      const t = [vt[0] / vtl, vt[1] / vtl, vt[2] / vtl];
      const rt = cross(r, t);
      const kt = this.invMass + dot(rt, this.applyInvInertia(rt));
      const jt = Math.min(vtl / kt, 0.6 * jn);
      for (let c = 0; c < 3; c++) J[c] -= t[c] * jt;
    }
    for (let c = 0; c < 3; c++) vel[c] += J[c] * this.invMass;
    const dw = this.applyInvInertia(cross(r, J));
    for (let c = 0; c < 3; c++) ang[c] += dw[c];
  }

  /** World inverse inertia applied to v: R * I^-1 * R^T * v. */
  private applyInvInertia(v: number[]): number[] {
    const l = this.rotate(v, true);
    return this.rotate([l[0] * this.invI[0], l[1] * this.invI[1], l[2] * this.invI[2]]);
  }

  rotate(v: number[], inverse = false): number[] {
    const [qx, qy, qz] = inverse ? [-this.rot[0], -this.rot[1], -this.rot[2]] : this.rot;
    const qw = this.rot[3];
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
  }

  /** Pushes a sphere at x[k] with radius r out of the lid's shell (the sphere moves, the lid does not). */
  pushOut(x: Float64Array, k: number, r: number) {
    if (!this.free) return;
    const l = this.local;
    l.set(this.rotate([x[k] - this.pos[0], x[k + 1] - this.pos[1], x[k + 2] - this.pos[2]], true));
    const [lx, ly, lz] = l;
    // Upside down, it is a tray: a ball can land inside it, and rolls off its rim (rounded, as the base's).
    for (const b of SHELL) pushSphereOutOfBox(l, 0, b, r, WALL / 2);
    const wp = this.rotate([l[0] - lx, l[1] - ly, l[2] - lz]);
    x[k] += wp[0];
    x[k + 1] += wp[1];
    x[k + 2] += wp[2];
  }
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

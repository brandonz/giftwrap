// Glass ornaments: spheres in a pit around the gift, with a pointer you can push and throw them with.

import { onTop, pushOutOfBox, pushSphereOutOfBox, type Collider, type SphereSet } from './cloth';
import { PIT_RADIUS, WALL } from './dims';
import type { Lid } from './lid';
import { rng } from './rng';

export class Ornaments implements SphereSet {
  readonly count: number;
  readonly pos: Float64Array;
  readonly vel: Float64Array;
  readonly radius: Float64Array;
  /** Kinematic pointer sphere; radius 0 = off. */
  readonly pointer = { x: 0, y: 0, z: 0, r: 0 };
  grabbed = -1;
  readonly grabTarget = [0, 0, 0];
  private cells = new Map<number, number[]>();

  constructor(count: number, seed: number) {
    const rnd = rng(seed);
    this.count = count;
    this.pos = new Float64Array(count * 3);
    this.vel = new Float64Array(count * 3);
    this.radius = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 1.75 + rnd() * (PIT_RADIUS - 2.1);
      this.radius[i] = 0.13 + rnd() * 0.1;
      this.pos[3 * i] = Math.cos(a) * r;
      this.pos[3 * i + 1] = 0.25 + rnd() * 1.6;
      this.pos[3 * i + 2] = Math.sin(a) * r;
    }
  }

  /** Lets the pile settle before the first frame is shown. */
  settle(box: Collider, seconds: number) {
    for (let t = 0; t < seconds * 60; t++) this.step(1 / 60, box, null);
    this.vel.fill(0);
  }

  burst(cx: number, cz: number, strength: number) {
    for (let i = 0; i < this.count; i++) {
      const dx = this.pos[3 * i] - cx;
      const dz = this.pos[3 * i + 2] - cz;
      const d = Math.hypot(dx, dz) + 0.3;
      const f = strength / d;
      this.vel[3 * i] += (dx / d) * f * 0.6;
      this.vel[3 * i + 1] += f * (0.8 + ((i * 7) % 5) * 0.1);
      this.vel[3 * i + 2] += (dz / d) * f * 0.6;
    }
  }

  step(dt: number, box: Collider, lid: Lid | null) {
    const sub = 2;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this.substep(h, box, lid);
  }

  private substep(h: number, box: Collider, lid: Lid | null) {
    const { pos: x, vel: v, radius: rad, count } = this;
    const prev = x.slice();
    const floor = 'floor' in box ? box.floor : null;
    for (let i = 0; i < count; i++) {
      const k = 3 * i;
      if (i === this.grabbed) {
        // Follow the pointer with a stiff spring; the velocity it builds up becomes the throw.
        for (let c = 0; c < 3; c++) {
          const want = (this.grabTarget[c] - x[k + c]) / h;
          v[k + c] += (want - v[k + c]) * 0.25;
        }
        const sp = Math.hypot(v[k], v[k + 1], v[k + 2]);
        if (sp > 14) for (let c = 0; c < 3; c++) v[k + c] *= 14 / sp;
      } else {
        v[k + 1] -= 9.81 * h;
      }
      v[k] *= 0.999;
      v[k + 1] *= 0.999;
      v[k + 2] *= 0.999;
      x[k] += v[k] * h;
      x[k + 1] += v[k + 1] * h;
      x[k + 2] += v[k + 2] * h;
    }

    // Sphere-sphere contacts through a hash grid.
    const cell = 0.5;
    const cells = this.cells;
    for (const l of cells.values()) l.length = 0;
    const key = (cx: number, cy: number, cz: number) => ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512);
    for (let i = 0; i < count; i++) {
      const kk = key(Math.floor(x[3 * i] / cell), Math.floor(x[3 * i + 1] / cell), Math.floor(x[3 * i + 2] / cell));
      let l = cells.get(kk);
      if (!l) cells.set(kk, (l = []));
      l.push(i);
    }
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(x[3 * i] / cell);
      const cy = Math.floor(x[3 * i + 1] / cell);
      const cz = Math.floor(x[3 * i + 2] / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const l = cells.get(key(cx + dx, cy + dy, cz + dz));
            if (!l) continue;
            for (const j of l) {
              if (j <= i) continue;
              const ex = x[3 * i] - x[3 * j];
              const ey = x[3 * i + 1] - x[3 * j + 1];
              const ez = x[3 * i + 2] - x[3 * j + 2];
              const R = rad[i] + rad[j];
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 >= R * R || d2 < 1e-12) continue;
              const d = Math.sqrt(d2);
              const wi = i === this.grabbed ? 0 : 1;
              const wj = j === this.grabbed ? 0 : 1;
              if (wi + wj === 0) continue;
              const c = (R - d) / d / (wi + wj);
              x[3 * i] += ex * c * wi;
              x[3 * i + 1] += ey * c * wi;
              x[3 * i + 2] += ez * c * wi;
              x[3 * j] -= ex * c * wj;
              x[3 * j + 1] -= ey * c * wj;
              x[3 * j + 2] -= ez * c * wj;
            }
          }
    }

    const p = this.pointer;
    for (let i = 0; i < count; i++) {
      const k = 3 * i;
      const r = rad[i];
      if (p.r > 0 && i !== this.grabbed) {
        const ex = x[k] - p.x;
        const ey = x[k + 1] - p.y;
        const ez = x[k + 2] - p.z;
        const R = r + p.r;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < R * R && d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const c = (R - d) / d;
          x[k] += ex * c;
          x[k + 1] += ey * c;
          x[k + 2] += ez * c;
        }
      }
      if ('floor' in box) {
        // Thin walls: inflated like a solid box, a wall would hold a ball up past the rim, over the opening.
        // The true contact, with the rim rounded, lets it roll off.
        pushSphereOutOfBox(x, k, box.floor, r);
        for (const b of box.walls) pushSphereOutOfBox(x, k, b, r, WALL / 2);
      } else pushOutOfBox(x, k, box, r);
      if (lid) lid.pushOut(x, k, r);
      const rr = Math.hypot(x[k], x[k + 2]);
      if (rr > PIT_RADIUS - r) {
        x[k] *= (PIT_RADIUS - r) / rr;
        x[k + 2] *= (PIT_RADIUS - r) / rr;
      }
      // The open box's floor is ground too (the push has just left a ball resting on it at its top + r).
      const ground = x[k + 1] < r || (floor !== null && onTop(x, k, floor, r + 1e-3));
      if (x[k + 1] < r) x[k + 1] = r;
      // Velocity from the corrected positions, with a little bounce off the ground.
      const vy = (x[k + 1] - prev[k + 1]) / h;
      v[k] = ((x[k] - prev[k]) / h) * (ground ? 0.985 : 1);
      v[k + 2] = ((x[k + 2] - prev[k + 2]) / h) * (ground ? 0.985 : 1);
      v[k + 1] = ground && v[k + 1] < -1 ? -v[k + 1] * 0.35 : vy;
    }
  }

  isFinite(): boolean {
    for (const q of this.pos) if (!Number.isFinite(q)) return false;
    return true;
  }
}

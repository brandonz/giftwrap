import { describe, expect, it } from 'vitest';
import { boxDistance } from '../src/sim/cloth';
import { BASE, FLOOR, GIFT, TOP, WALL } from '../src/sim/dims';
import { OPEN_BASE, World, type WorldOptions } from '../src/sim/world';

const base: WorldOptions = { detail: 'high', ornaments: 60, bow: 0, ribbonWidth: 1, unwrappable: true };

function run(w: World, frames: number) {
  for (let f = 0; f < frames; f++) w.step(1 / 60);
}

/** Drags a point outward and up over `frames`, like a finger pulling. */
function pull(w: World, kind: 'paper' | 'ribbon', from: number[], frames = 36) {
  if (!w.beginGrab(kind, from)) return false;
  const dir = [Math.sign(from[0]) * 1.6, 1.6, Math.sign(from[2]) * 1.6];
  for (let f = 1; f <= frames; f++) {
    const t = f / frames;
    w.moveGrab([from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t]);
    w.step(1 / 60);
  }
  w.endGrab();
  run(w, 24);
  return true;
}

function pointOnPaper(w: World, n: number): number[] | null {
  const c = w.paper.cloth;
  let best = -1;
  let score = -Infinity;
  for (let i = 0; i < c.n; i++) {
    const x = c.x[3 * i];
    const y = c.x[3 * i + 1];
    const z = c.x[3 * i + 2];
    const onBox = Math.max(Math.abs(x) - GIFT.hx, Math.abs(y - GIFT.cy) - GIFT.hy, Math.abs(z) - GIFT.hz) < 0.03 && y > 0.05;
    if (!onBox) continue;
    const s = Math.sin(i * 12.9898 + n * 78.233) + y * 0.4;
    if (s > score) {
      score = s;
      best = i;
    }
  }
  return best < 0 ? null : [c.x[3 * best], c.x[3 * best + 1], c.x[3 * best + 2]];
}

describe('world', () => {
  it('sits still when nobody touches it', () => {
    const w = new World(base);
    const before = w.measurePaperOn();
    run(w, 120);
    expect(w.isFinite()).toBe(true);
    expect(w.paper.cloth.brokenSeams).toBe(0);
    expect(w.measurePaperOn()).toBeCloseTo(before, 2);
    expect(w.phase).toBe('tied');
  });

  it('holds the paper while the ribbon is tied', () => {
    const w = new World(base);
    pull(w, 'paper', pointOnPaper(w, 1)!);
    expect(w.paper.cloth.brokenSeams).toBe(0);
    expect(w.phase).toBe('tied');
  });

  it('unties when the bow is pulled, then unwraps within a few pulls', () => {
    for (const [detail, bow] of [['high', 0], ['high', 1], ['high', 2], ['low', 0]] as const) {
      const w = new World({ ...base, detail, bow });
      const opened: string[] = [];
      w.events = { untie: () => opened.push('untie'), open: () => opened.push('open') };
      expect(pull(w, 'ribbon', bowPoint(w), 30)).toBe(true);
      expect(w.phase).toBe('loose');
      let n = 0;
      while (w.phase !== 'open' && n < 20) {
        const p = pointOnPaper(w, n);
        if (!p) break;
        pull(w, 'paper', p);
        n++;
      }
      run(w, 60);
      expect(w.phase, `${detail} bow ${bow}`).toBe('open');
      expect(n, `${detail} bow ${bow}`).toBeLessThanOrEqual(PULL_LIMIT);
      expect(opened).toEqual(['untie', 'open']);
      expect(w.isFinite()).toBe(true);
    }
  });

  it('can be opened from the keyboard alone', () => {
    const w = new World({ ...base, detail: 'low' });
    let presses = 0;
    while (w.phase !== 'open' && presses < 40) {
      w.assist();
      run(w, 40);
      presses++;
    }
    expect(w.phase).toBe('open');
    expect(presses).toBeLessThanOrEqual(12);
    run(w, 180);
    expect(w.isFinite()).toBe(true);
    // The lid has come off and landed.
    expect(w.lid.pos[1]).toBeLessThan(TOP);
  });

  it('opens into a hollow box that nothing passes through', () => {
    for (const detail of ['high', 'low'] as const) {
      const w = opened({ ...base, detail });
      let ball = -Infinity;
      let particle = -Infinity;
      for (let f = 0; f < 240; f++) {
        w.step(1 / 60);
        const o = w.ornaments;
        for (let i = 0; i < o.count; i++) ball = Math.max(ball, depthInBase(o.pos, i));
        // A particle may be pressed into a wall by an ornament, but never deeper than its own radius.
        for (const c of [w.paper.cloth, w.ribbon.cloth]) {
          for (let i = 0; i < c.n; i++) particle = Math.max(particle, depthInBase(c.x, i) - c.radius);
        }
      }
      expect(w.isFinite()).toBe(true);
      expect(ball, `${detail}: deepest ornament centre`).toBeLessThanOrEqual(0);
      expect(particle, `${detail}: deepest particle`).toBeLessThanOrEqual(0);
    }
  });

  it('catches what falls into the open box', () => {
    const w = opened(base);
    run(w, 120);
    const o = w.ornaments;
    // One ball over the middle, one that clips the rim's inner edge on the way down.
    const drops = [
      [0, 0, 7],
      [BASE.hx - WALL - 0.06, 0.3, 21],
    ];
    for (const [x, z, i] of drops) {
      o.pos.set([x, 2.5, z], 3 * i);
      o.vel.fill(0, 3 * i, 3 * i + 3);
    }
    // And a scrap of paper, laid flat over the opening.
    const { cloth, shardOf } = w.paper;
    const scrap = [...shardOf.keys()].filter((i) => shardOf[i] === 3);
    const c = centroid(cloth.x, scrap);
    for (const i of scrap) {
      cloth.x.set([cloth.x[3 * i] - c[0], 2.2, cloth.x[3 * i + 2] - c[2]], 3 * i);
      cloth.v.fill(0, 3 * i, 3 * i + 3);
    }
    run(w, 240);
    const inside = BASE.hx - WALL;
    for (const [, , i] of drops) {
      const p = o.pos.slice(3 * i, 3 * i + 3);
      expect(Math.max(Math.abs(p[0]), Math.abs(p[2])), `ball ${i}`).toBeLessThan(inside - o.radius[i] + 0.01);
      expect(p[1], `ball ${i}`).toBeCloseTo(FLOOR + o.radius[i], 2);
    }
    for (const i of scrap) {
      expect(Math.max(Math.abs(cloth.x[3 * i]), Math.abs(cloth.x[3 * i + 2]))).toBeLessThan(inside);
      expect(cloth.x[3 * i + 1]).toBeCloseTo(FLOOR + cloth.radius, 2);
    }
  });

  it('rolls a ball off the rim', () => {
    const w = opened(base);
    run(w, 120);
    const o = w.ornaments;
    // A few millimetres either side of the rim's centre line: one should fall in, the other out.
    const rim = BASE.hx - WALL / 2;
    const [inside, outside] = [7, 21];
    o.pos.set([rim - 0.004, 2.5, 0.3], 3 * inside);
    o.pos.set([rim + 0.004, 2.5, -0.3], 3 * outside);
    o.vel.fill(0);
    run(w, 240);
    expect(o.pos[3 * inside]).toBeLessThan(BASE.hx - WALL - o.radius[inside] + 0.01);
    expect(o.pos[3 * inside + 1]).toBeCloseTo(FLOOR + o.radius[inside], 2);
    expect(o.pos[3 * outside]).toBeGreaterThan(BASE.hx);
    expect(o.pos[3 * outside + 1]).toBeLessThan(BASE.cy + BASE.hy);
  });

  it('lets a ball roll to a stop on the inner floor', () => {
    const w = opened(base);
    run(w, 120);
    const o = w.ornaments;
    o.pos.set([-0.3, FLOOR + o.radius[7], 0], 3 * 7);
    o.vel.set([1, 0, 0], 3 * 7);
    run(w, 180);
    // Rolling, not gliding into the far wall.
    expect(o.pos[3 * 7]).toBeLessThan(BASE.hx - WALL - o.radius[7] - 0.1);
    expect(Math.hypot(...o.vel.slice(3 * 7, 3 * 7 + 3))).toBeLessThan(0.01);
  });

  it('lands the lid as a tray that holds a ball', () => {
    const w = opened(base);
    run(w, 120);
    const L = w.lid;
    // Upside down, so the open side faces up.
    expect(L.rotate([0, 1, 0])[1]).toBeLessThan(-0.99);
    const o = w.ornaments;
    o.pos.set([L.pos[0], 2, L.pos[2]], 0);
    o.vel.fill(0, 0, 3);
    run(w, 180);
    // On the inside of the lid's top, not on its rim.
    expect(o.pos[1] - o.radius[0]).toBeCloseTo(WALL, 2);
  });

  it('never comes undone on the wrap page', () => {
    const w = new World({ ...base, unwrappable: false });
    pull(w, 'ribbon', bowPoint(w), 40);
    w.assist();
    run(w, 60);
    expect(w.phase).toBe('tied');
  });
});

/** A world opened from the keyboard, a moment after it opens. */
function opened(opts: WorldOptions): World {
  const w = new World(opts);
  for (let presses = 0; w.phase !== 'open' && presses < 40; presses++) {
    w.assist();
    run(w, 40);
  }
  expect(w.phase).toBe('open');
  return w;
}

/** How deep point i is inside the open base's walls and floor (negative: outside them). */
function depthInBase(x: ArrayLike<number>, i: number): number {
  return Math.max(...[OPEN_BASE.floor, ...OPEN_BASE.walls].map((b) => -boxDistance(x, 3 * i, b)));
}

function centroid(x: ArrayLike<number>, ids: number[]): number[] {
  const c = [0, 0, 0];
  for (const i of ids) for (let a = 0; a < 3; a++) c[a] += x[3 * i + a] / ids.length;
  return c;
}

/** Below the 12-pull assist, so the paper itself has to tear. */
const PULL_LIMIT = 10;

/** Where a tap on the bow lands: its highest particle. */
function bowPoint(w: World): number[] {
  const { cloth, bowStart } = w.ribbon;
  let best = bowStart;
  for (let i = bowStart; i < cloth.n; i++) if (cloth.x[3 * i + 1] > cloth.x[3 * best + 1]) best = i;
  return [cloth.x[3 * best], cloth.x[3 * best + 1], cloth.x[3 * best + 2]];
}

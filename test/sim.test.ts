import { describe, expect, it } from 'vitest';
import { GIFT, TOP } from '../src/sim/dims';
import { World, type WorldOptions } from '../src/sim/world';

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

  it('never comes undone on the wrap page', () => {
    const w = new World({ ...base, unwrappable: false });
    pull(w, 'ribbon', bowPoint(w), 40);
    w.assist();
    run(w, 60);
    expect(w.phase).toBe('tied');
  });
});

/** Below the 12-pull assist, so the paper itself has to tear. */
const PULL_LIMIT = 10;

/** Where a tap on the bow lands: its highest particle. */
function bowPoint(w: World): number[] {
  const { cloth, bowStart } = w.ribbon;
  let best = bowStart;
  for (let i = bowStart; i < cloth.n; i++) if (cloth.x[3 * i + 1] > cloth.x[3 * best + 1]) best = i;
  return [cloth.x[3 * best], cloth.x[3 * best + 1], cloth.x[3 * best + 2]];
}

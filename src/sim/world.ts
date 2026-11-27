// Everything that moves, and the unwrapping rules: untie the ribbon, tear the paper, the lid pops.

import { boxDistance, type Aabb, type OpenBox } from './cloth';
import { BASE, FLOOR, GIFT, LID, WALL } from './dims';
import { Lid } from './lid';
import { Ornaments } from './ornaments';
import { buildPaper, GLUE_BREAK, GLUE_K, type Paper } from './paper';
import { buildRibbon, type Ribbon } from './ribbon';

export type Phase = 'tied' | 'loose' | 'open';
export type GrabKind = 'paper' | 'ribbon' | 'ornament';

export interface WorldOptions {
  detail: 'high' | 'low';
  ornaments: number;
  bow: number;
  ribbonWidth: number;
  /** false on the wrap page: the gift never comes undone. */
  unwrappable: boolean;
  seed?: number;
}

export interface WorldEvents {
  untie?: () => void;
  tear?: () => void;
  open?: () => void;
}

/** Pulls after which the remaining glue gives up, so nobody is stuck on the last scrap. */
export const ASSIST_PULLS = 12;
/** Fraction of paper still on the box below which the gift opens. */
export const OPEN_AT = 0.3;
/** How far the finger must drag the ribbon to untie it. */
const UNTIE_PULL = 0.45;
/** While tied, the ribbon holds all the paper in place. */
const TIED_HOLD = 0.3;

const GIFT_BOX: Aabb = GIFT;
/** The open base: a floor and four walls, so what lands in the opening falls inside. */
export const OPEN_BASE: OpenBox = openBase();

function openBase(): OpenBox {
  const { cx, cy, cz, hx, hy, hz } = BASE;
  const t = WALL / 2;
  return {
    // Between the walls, so its top edge is no ledge on the outside, and reaching well below the ground:
    // whatever sinks into it is pushed up, never out underneath.
    floor: { cx, cy: (FLOOR - 1) / 2, cz, hx: hx - WALL, hy: (FLOOR + 1) / 2, hz: hz - WALL },
    walls: [
      { cx: cx - hx + t, cy, cz, hx: t, hy, hz },
      { cx: cx + hx - t, cy, cz, hx: t, hy, hz },
      { cx, cy, cz: cz - hz + t, hx, hy, hz: t },
      { cx, cy, cz: cz + hz - t, hx, hy, hz: t },
    ],
  };
}

export class World {
  readonly opts: WorldOptions;
  paper: Paper;
  ribbon: Ribbon;
  readonly ornaments: Ornaments;
  readonly lid = new Lid();
  phase: Phase = 'tied';
  pulls = 0;
  paperOn = 1;
  events: WorldEvents = {};
  private grabKind: GrabKind | null = null;
  private readonly grabStart = [0, 0, 0];
  private frame = 0;
  private readonly seed: number;

  constructor(opts: WorldOptions) {
    this.opts = opts;
    this.seed = opts.seed ?? 7;
    this.paper = this.makePaper();
    this.ribbon = buildRibbon(opts.bow, opts.ribbonWidth);
    this.ornaments = new Ornaments(opts.ornaments, this.seed + 1);
    this.ornaments.settle(GIFT_BOX, 2.5);
    this.lockPaper(true);
  }

  private makePaper(): Paper {
    const high = this.opts.detail === 'high';
    return buildPaper({ cells: high ? 12 : 8, shards: 20, glue: 0.08, seed: this.seed });
  }

  /** Swaps the ribbon (wrap page option changes). */
  setRibbon(bow: number, width: number) {
    this.ribbon = buildRibbon(bow, width);
  }

  get grabbing(): GrabKind | null {
    return this.grabKind;
  }

  beginGrab(kind: GrabKind, point: ArrayLike<number>, ornament = -1): boolean {
    this.endGrab();
    if (kind === 'ornament') {
      if (ornament < 0) return false;
      this.ornaments.grabbed = ornament;
      this.moveGrab(point);
    } else if (kind === 'ribbon') {
      if (!this.ribbon.cloth.grab(point, 0.13)) return false;
    } else {
      if (!this.paper.cloth.grab(point, this.paper.grabRadius)) return false;
    }
    this.grabKind = kind;
    this.grabStart[0] = point[0];
    this.grabStart[1] = point[1];
    this.grabStart[2] = point[2];
    return true;
  }

  moveGrab(point: ArrayLike<number>) {
    const t =
      this.grabKind === 'ornament' || (this.grabKind === null && this.ornaments.grabbed >= 0)
        ? this.ornaments.grabTarget
        : this.grabKind === 'ribbon'
          ? this.ribbon.cloth.grabTarget
          : this.paper.cloth.grabTarget;
    t[0] = point[0];
    t[1] = point[1];
    t[2] = point[2];
  }

  endGrab() {
    if (this.grabKind === 'paper' && this.phase === 'loose') {
      this.pulls++;
      this.events.tear?.();
      if (this.pulls >= ASSIST_PULLS) this.loosenGlue();
    }
    this.paper.cloth.release();
    this.ribbon.cloth.release();
    this.ornaments.grabbed = -1;
    this.grabKind = null;
  }

  /** Keyboard or button stand-in for a pull: unties, then tears one piece at a time. */
  assist() {
    if (!this.opts.unwrappable) {
      this.wiggle();
      return;
    }
    if (this.phase === 'tied') {
      this.untie();
      return;
    }
    if (this.phase !== 'loose') return;
    const { cloth, shardOf } = this.paper;
    // Tear off the shards with the most paper still on the box, preferring the top.
    const score = new Float64Array(this.paper.shardCount);
    for (let i = 0; i < cloth.n; i++) {
      if (boxDistance(cloth.x, 3 * i, GIFT_BOX) < 0.04) score[shardOf[i]] += 1 + cloth.x[3 * i + 1] * 0.3;
    }
    // Two pieces per press, so the keyboard path takes about as many presses as pulls.
    const order = [...score.keys()].sort((a, b) => score[b] - score[a]);
    const torn = new Set(order.slice(0, 2).filter((s) => score[s] > 0));
    if (!torn.size) return;
    for (let c = 0; c < cloth.sa.length; c++) {
      if (torn.has(shardOf[cloth.sa[c]]) || torn.has(shardOf[cloth.sb[c]])) cloth.seamAlive[c] = 0;
    }
    for (let i = 0; i < cloth.n; i++) {
      if (!torn.has(shardOf[i])) continue;
      cloth.anchorK[i] = 0;
      const k = 3 * i;
      const d = Math.hypot(cloth.x[k], cloth.x[k + 2]) + 0.2;
      cloth.impulse(i, (cloth.x[k] / d) * 2.2, 2.6, (cloth.x[k + 2] / d) * 2.2);
    }
    this.pulls++;
    this.events.tear?.();
  }

  /** A friendly shake of the bow, used as a hint and on the wrap page. */
  wiggle() {
    const { cloth, bowStart } = this.ribbon;
    for (let i = bowStart; i < cloth.n; i++) if (cloth.w[i] > 0) cloth.impulse(i, 0, 1.6 + (i % 3) * 0.4, 0);
  }

  untie() {
    if (this.phase !== 'tied' || !this.opts.unwrappable) return;
    this.phase = 'loose';
    const { cloth, knot, bowStart } = this.ribbon;
    cloth.release();
    cloth.anchorK.fill(0);
    for (let i = 0; i < cloth.n; i++) {
      cloth.w[i] = 1;
      const k = 3 * i;
      const dx = cloth.x[k] - knot[0];
      const dz = cloth.x[k + 2] - knot[2];
      const d = Math.hypot(dx, dz) + 0.15;
      const bowPart = i >= bowStart;
      cloth.impulse(i, (dx / d) * (bowPart ? 2.6 : 1.4), bowPart ? 2.4 : 1.2, (dz / d) * (bowPart ? 2.6 : 1.4));
    }
    this.grabKind = null;
    this.lockPaper(false);
    this.events.untie?.();
  }

  private lockPaper(locked: boolean) {
    const c = this.paper.cloth;
    const glued = this.paper.glued;
    c.seamsLocked = locked;
    for (let i = 0; i < c.n; i++) {
      if (locked) {
        c.anchorK[i] = glued[i] ? GLUE_K : TIED_HOLD;
        c.anchorBreak[i] = Infinity;
      } else {
        c.anchorK[i] = glued[i] ? GLUE_K : 0;
        c.anchorBreak[i] = GLUE_BREAK;
      }
    }
  }

  private loosenGlue() {
    const c = this.paper.cloth;
    for (let i = 0; i < c.n; i++) c.anchorBreak[i] = Math.min(c.anchorBreak[i], 0.01);
    c.seamBreak = 0.02;
  }

  open() {
    if (this.phase === 'open') return;
    this.phase = 'open';
    const c = this.paper.cloth;
    c.release();
    c.seamAlive.fill(0);
    c.anchorK.fill(0);
    for (let i = 0; i < c.n; i++) {
      const k = 3 * i;
      const d = Math.hypot(c.x[k], c.x[k + 2]) + 0.3;
      const up = c.x[k + 1] > GIFT.cy + GIFT.hy - 0.05 ? 3.4 : 1.2;
      c.impulse(i, (c.x[k] / d) * 2.4, up, (c.x[k + 2] / d) * 2.4);
    }
    const r = this.ribbon.cloth;
    r.release();
    r.anchorK.fill(0);
    r.w.fill(1);
    this.lid.pop(this.seed);
    this.ornaments.burst(0, 0, 3.2);
    this.grabKind = null;
    this.events.open?.();
  }

  step(dt: number) {
    this.frame++;
    const high = this.opts.detail === 'high';
    const box = this.phase === 'open' ? OPEN_BASE : GIFT_BOX;
    this.ornaments.step(dt, box, this.lid);
    this.paper.cloth.step(dt, 8, box);
    this.ribbon.cloth.step(dt, high ? 6 : 4, box);
    if (this.phase !== 'tied') {
      this.paper.cloth.collideSpheres(this.ornaments);
      this.ribbon.cloth.collideSpheres(this.ornaments);
    }
    this.lid.step(dt);

    if (this.phase === 'tied' && this.opts.unwrappable && this.grabKind === 'ribbon' && this.dragDistance() > UNTIE_PULL) {
      this.untie();
    }
    if (this.phase === 'loose' && this.frame % 15 === 0) {
      this.paperOn = this.measurePaperOn();
      if (this.paperOn < OPEN_AT) this.open();
    }
  }

  /** How far the pointer has moved since the grab began. */
  private dragDistance(): number {
    const t = this.ribbon.cloth.grabTarget;
    const s = this.grabStart;
    return Math.hypot(t[0] - s[0], t[1] - s[1], t[2] - s[2]);
  }

  measurePaperOn(): number {
    const c = this.paper.cloth;
    let on = 0;
    for (let i = 0; i < c.n; i++) if (boxDistance(c.x, 3 * i, GIFT_BOX) < 0.05 && c.x[3 * i + 1] > 0.05) on++;
    return on / c.n;
  }

  isFinite(): boolean {
    return this.paper.cloth.isFinite() && this.ribbon.cloth.isFinite() && this.ornaments.isFinite() && this.lid.pos.every(Number.isFinite);
  }
}

export { GIFT, LID };

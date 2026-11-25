// Gift dimensions, in metres-ish scene units. The ground is y = 0.

/** Outer box (base plus lid), which the paper wraps. */
export const GIFT = { cx: 0, cy: 0.7, cz: 0, hx: 1, hy: 0.7, hz: 1 };
/** The base box, under the lid's lip. */
export const BASE = { cx: 0, cy: 0.65, cz: 0, hx: 0.97, hy: 0.65, hz: 0.97 };
/** The lid, as a box. */
export const LID = { cx: 0, cy: 1.27, cz: 0, hx: 1, hy: 0.13, hz: 1 };

export const PAPER_OFFSET = 0.008;
export const RIBBON_OFFSET = 0.022;
export const TOP = GIFT.cy + GIFT.hy;
/** Ornaments stay inside this radius. */
export const PIT_RADIUS = 3.4;

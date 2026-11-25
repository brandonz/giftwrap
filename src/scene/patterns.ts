// Wrapping paper patterns, drawn in code to a seamless tile. No image assets.

import type { Rgb } from '../codec/gift';

/** Size of one pattern tile on the gift, in scene units, per scale step. */
export const TILE_SIZES = [0.95, 0.7, 0.5, 0.34];

const css = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;

/** Draws pattern `kind` into a square canvas of `size` pixels. The tile wraps seamlessly. */
export function drawPattern(canvas: HTMLCanvasElement, kind: number, base: Rgb, accent: Rgb, size = 512) {
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const S = size;
  g.fillStyle = css(base);
  g.fillRect(0, 0, S, S);

  // Fine paper grain, so flat colours still read as paper.
  let seed = 9;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < (S * S) / 90; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
    g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
  }

  // Draws f at (x, y) and at every wrapped copy that could cross the tile edge.
  const tiled = (x: number, y: number, f: (x: number, y: number) => void) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) f(x + dx, y + dy);
  };
  const soft = mix(base, accent, 0.35);

  switch (kind) {
    case 0: {
      // Snowflakes
      const flakes = [
        [0.18, 0.2, 0.11], [0.62, 0.12, 0.07], [0.84, 0.55, 0.1], [0.38, 0.62, 0.12], [0.1, 0.86, 0.06],
        [0.66, 0.86, 0.08], [0.5, 0.36, 0.045], [0.9, 0.24, 0.04], [0.24, 0.42, 0.035], [0.78, 0.75, 0.035],
      ];
      for (const [fx, fy, fr] of flakes) tiled(fx * S, fy * S, (x, y) => snowflake(g, x, y, fr * S, fr > 0.05 ? accent : soft));
      break;
    }
    case 1: {
      // Candy stripe
      g.save();
      g.beginPath();
      g.rect(0, 0, S, S);
      g.clip();
      const n = 4;
      const w = S / n;
      for (let i = -n; i < 2 * n; i++) {
        g.fillStyle = css(accent);
        polygon(g, [[i * w, 0], [i * w + w * 0.45, 0], [i * w + w * 0.45 + S, S], [i * w + S, S]]);
        g.fillStyle = css(soft, 0.9);
        polygon(g, [[i * w + w * 0.6, 0], [i * w + w * 0.68, 0], [i * w + w * 0.68 + S, S], [i * w + w * 0.6 + S, S]]);
      }
      g.restore();
      break;
    }
    case 2: {
      // Plaid
      const bands = (horizontal: boolean) => {
        for (const [at, wd, a, c] of [
          [0.25, 0.22, 0.55, accent], [0.75, 0.08, 0.5, soft], [0.62, 0.02, 0.8, accent], [0.88, 0.02, 0.8, accent], [0.05, 0.03, 0.4, soft],
        ] as [number, number, number, Rgb][]) {
          g.fillStyle = css(c, a);
          if (horizontal) g.fillRect(0, (at - wd / 2) * S, S, wd * S);
          else g.fillRect((at - wd / 2) * S, 0, wd * S, S);
        }
      };
      bands(true);
      bands(false);
      break;
    }
    case 3: {
      // Pine trees
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const x = ((col + (row % 2) * 0.5) / 3) * S + S / 6;
          const y = (row / 3) * S + S / 6;
          tiled(x, y, (tx, ty) => tree(g, tx, ty, S / 7.5, accent, soft));
        }
      }
      break;
    }
    case 4: {
      // Stars
      const stars = [[0.2, 0.22, 0.09], [0.7, 0.18, 0.06], [0.45, 0.55, 0.1], [0.85, 0.7, 0.07], [0.15, 0.78, 0.06], [0.6, 0.9, 0.04], [0.92, 0.42, 0.035]];
      for (const [sx, sy, sr] of stars) tiled(sx * S, sy * S, (x, y) => star(g, x, y, sr * S, sr > 0.05 ? accent : soft));
      for (let i = 0; i < 26; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        g.fillStyle = css(soft, 0.9);
        tiled(x, y, (tx, ty) => circle(g, tx, ty, S * 0.006));
      }
      break;
    }
    case 5: {
      // Dots
      const n = 5;
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          const x = ((c + (r % 2) * 0.5) / n) * S;
          const y = (r / n) * S + S / (2 * n);
          g.fillStyle = css(accent);
          tiled(x, y, (tx, ty) => circle(g, tx, ty, S * 0.045));
        }
      break;
    }
    case 6: {
      // Holly
      const sprigs = [[0.25, 0.25, 0.4], [0.75, 0.3, -0.6], [0.3, 0.75, -0.2], [0.78, 0.8, 1]];
      for (const [hx, hy, a] of sprigs) tiled(hx * S, hy * S, (x, y) => holly(g, x, y, S * 0.13, a, accent, mix(accent, [0, 0, 0], 0.35), base));
      break;
    }
    default: {
      // Plain: a faint fleck so it still has some life.
      for (let i = 0; i < 160; i++) {
        g.fillStyle = css(accent, 0.18);
        const x = rnd() * S;
        const y = rnd() * S;
        tiled(x, y, (tx, ty) => circle(g, tx, ty, S * 0.004));
      }
    }
  }
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function polygon(g: CanvasRenderingContext2D, pts: number[][]) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}

function snowflake(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: Rgb) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = css(c);
  g.lineCap = 'round';
  g.lineWidth = Math.max(1.5, r * 0.11);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -r);
    for (const t of [0.45, 0.7]) {
      g.moveTo(0, -r * t);
      g.lineTo(r * 0.22, -r * (t + 0.18));
      g.moveTo(0, -r * t);
      g.lineTo(-r * 0.22, -r * (t + 0.18));
    }
    g.stroke();
  }
  g.restore();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: Rgb) {
  const pts: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  g.fillStyle = css(c);
  polygon(g, pts);
}

function tree(g: CanvasRenderingContext2D, x: number, y: number, s: number, c: Rgb, trunk: Rgb) {
  g.fillStyle = css(trunk);
  g.fillRect(x - s * 0.08, y + s * 0.55, s * 0.16, s * 0.25);
  g.fillStyle = css(c);
  for (let t = 0; t < 3; t++) {
    const w = s * (0.65 - t * 0.14);
    const top = y - s * 0.75 + t * s * 0.33;
    polygon(g, [[x, top], [x + w, top + s * 0.6], [x - w, top + s * 0.6]]);
  }
}

function holly(g: CanvasRenderingContext2D, x: number, y: number, s: number, a: number, leaf: Rgb, berry: Rgb, vein: Rgb) {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = css(leaf);
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, 0);
    // A spiky leaf: a lens with three bites along each edge.
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const bump = i % 2 ? 0.3 : 0.42;
      g.lineTo(side * s * 1.4 * t, -s * bump * Math.sin(Math.PI * t));
    }
    for (let i = 6; i >= 0; i--) {
      const t = i / 6;
      const bump = i % 2 ? 0.3 : 0.42;
      g.lineTo(side * s * 1.4 * t, s * bump * Math.sin(Math.PI * t));
    }
    g.fill();
    // A vein down the middle so the leaf reads as a leaf at small sizes.
    g.strokeStyle = css(vein, 0.7);
    g.lineWidth = Math.max(1, s * 0.05);
    g.beginPath();
    g.moveTo(side * s * 0.15, 0);
    g.lineTo(side * s * 1.25, 0);
    g.stroke();
  }
  g.fillStyle = css(berry);
  for (const [bx, by] of [[0, -0.18], [-0.17, 0.08], [0.17, 0.08]]) circle(g, bx * s, by * s, s * 0.17);
  g.restore();
}

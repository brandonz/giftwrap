// The sealed envelope the gift's card arrives in. One drawing, used twice: whole, on the 3D card that
// rises out of the box (envelopeArt), and in parts (back, flap, seal) over the page's card that takes
// its place (openEnvelope), so nothing changes at the swap. Sizes are CSS pixels of the card's border box.

/** The card's corner radius (.reveal in style.css). */
const RADIUS = 22;
/** The gold edge round the sealed card. */
const EDGE = 2.5;
const GOLD = 'rgba(242, 193, 78, 0.85)';
const SEAL = 21;
/** Room round the flap and the seal for their shadows. */
const PAD = 10;
/** A gift, on a 24px grid like the icons. */
const GLYPH = 'M4.5 11h15v8.5h-15z M3.5 8h17v3h-17z M12 8v11.5 M12 8C10.5 4.5 7 4.5 7 6.5s3 1.5 5 1.5z M12 8C13.5 4.5 17 4.5 17 6.5s-3 1.5-5 1.5z';

/** Timings, in ms: the flight to the card's place, the flap swinging open, and the gap between contents. */
const FLY = 560;
const FLAP = 440;
const STAGGER = 60;
/** The flap starts to open as the card settles into place. */
const OPENS = FLY - 100;
/** The flap is past upright: the letter comes out. */
const OUT = OPENS + FLAP * 0.4;

/** How far down the card the closed flap's tip reaches. */
function flapDepth(w: number, h: number): number {
  return Math.round(Math.min(w * 0.42, h * 0.62));
}

/**
 * The whole sealed envelope in one picture, for the 3D card, at `scale` device pixels per CSS pixel: the
 * renderer's pixel ratio, so it is no softer than the page's card it turns into.
 */
export function envelopeArt(w: number, h: number, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const g = sized(c, w, h, scale);
  drawBack(g, w, h);
  drawFlap(g, w, h);
  drawSeal(g, w / 2, flapDepth(w, h));
  return c;
}

/**
 * Brings the card in sealed, from `from` (a box on the page: the 3D card's, or the flat gift's) to its
 * place, then opens it: the seal pops, the flap swings up over the top and the contents come out.
 * Settles with the card open and the envelope gone, whatever happens to the animations on the way.
 */
export function openEnvelope(card: HTMLElement, from: DOMRect): Promise<void> {
  const to = card.getBoundingClientRect();
  const { back, flap, seal } = paint(card, to.width, to.height);
  // Uniform scale, centred on `from`: the 3D card has the same shape, so it lands exactly on it.
  const k = Math.min(from.width / to.width, from.height / to.height);
  const dx = from.x + from.width / 2 - (to.x + to.width / 2);
  const dy = from.y + from.height / 2 - (to.y + to.height / 2);
  const body = card.querySelector('.reveal-body')!;
  const contents = [...body.children].filter((el) => !(el as HTMLElement).hidden);
  const swing = (deg: number) => `perspective(${Math.round(to.width * 2.5)}px) rotateX(${deg}deg)`;
  // Only the starting states are held (fill: 'backwards'), and the envelope's parts are invisible unless
  // animated (style.css): a cancelled animation leaves the card open and in place rather than sealed.
  const anims = [
    card.animate({ transform: [`translate(${dx}px, ${dy}px) scale(${k})`, 'none'] }, { duration: FLY, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.12)' }),
    // Its drop shadow (its own layer, style.css) fades in as it comes to the front; the 3D card has none.
    card.animate({ opacity: [0, 1] }, { pseudoElement: '::before', duration: FLY, fill: 'backwards' }),
    back.animate({ opacity: [1, 0] }, { delay: OUT, duration: 320, fill: 'backwards' }),
    flap.animate(
      [
        { transform: swing(0), opacity: 1, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' },
        { transform: swing(180), opacity: 1, offset: 0.75 },
        { transform: swing(180), opacity: 0 },
      ],
      { delay: OPENS, duration: FLAP / 0.75, fill: 'backwards' },
    ),
    seal.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.4)' }], {
      delay: OPENS,
      duration: 180,
      easing: 'ease-in',
      fill: 'backwards',
    }),
    ...contents.map((el, i) =>
      el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], {
        delay: OUT + i * STAGGER,
        duration: 320,
        easing: 'ease-out',
        fill: 'backwards',
      }),
    ),
  ];
  const done = () => {
    for (const c of [back, flap, seal]) {
      c.hidden = true;
      // Gives back their bitmaps.
      c.width = c.height = 0;
    }
  };
  return Promise.all(anims.map((a) => a.finished)).then(done, done);
}

/** Draws the envelope's parts on their canvases over the card, sized to its border box, and shows them. */
function paint(card: HTMLElement, w: number, h: number) {
  const scale = Math.min(devicePixelRatio, 2);
  // Positioned from the padding box; the envelope covers the border too.
  const edge = -card.clientLeft;
  const d = flapDepth(w, h);
  const part = (name: string, x: number, y: number, cw: number, ch: number) => {
    const c = card.querySelector(`canvas.${name}`) as HTMLCanvasElement;
    Object.assign(c.style, { left: `${x}px`, top: `${y}px`, width: `${cw}px`, height: `${ch}px` });
    c.hidden = false;
    return { c, g: sized(c, cw, ch, scale) };
  };
  const back = part('envelope', edge, edge, w, h);
  drawBack(back.g, w, h);
  const flap = part('flap', edge, edge, w, d + PAD);
  drawFlap(flap.g, w, h);
  const r = SEAL + PAD;
  const seal = part('seal', edge + w / 2 - r, edge + d - r, 2 * r, 2 * r);
  drawSeal(seal.g, r, r);
  return { back: back.c, flap: flap.c, seal: seal.c };
}

/** Sizes a canvas to w x h CSS pixels at `scale` device pixels each, and returns it ready to draw in CSS pixels. */
function sized(c: HTMLCanvasElement, w: number, h: number, scale: number): CanvasRenderingContext2D {
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const g = c.getContext('2d')!;
  g.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
  return g;
}

/** The envelope's back: the card, solid navy, with a gold edge and the fold of its pocket. */
function drawBack(g: CanvasRenderingContext2D, w: number, h: number) {
  const fill = g.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, '#0f1f40');
  fill.addColorStop(1, '#0a1630');
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(0, 0, w, h, RADIUS);
  g.fill();
  g.beginPath();
  g.moveTo(EDGE, h - RADIUS);
  g.lineTo(w / 2, h - Math.min(w * 0.5, h * 0.42));
  g.lineTo(w - EDGE, h - RADIUS);
  g.strokeStyle = 'rgba(242, 193, 78, 0.3)';
  g.lineWidth = 1.5;
  g.lineJoin = 'round';
  g.stroke();
  g.strokeStyle = GOLD;
  g.lineWidth = EDGE;
  g.beginPath();
  g.roundRect(EDGE / 2, EDGE / 2, w - EDGE, h - EDGE, RADIUS - EDGE / 2);
  g.stroke();
}

/** The closed flap: a triangle from the top corners, inside the gold edge, down to a tip. */
function drawFlap(g: CanvasRenderingContext2D, w: number, h: number) {
  const d = flapDepth(w, h);
  // Shadows ignore the transform: scale them by hand to look the same at any resolution.
  const s = g.getTransform().a;
  const r = RADIUS - EDGE;
  g.save();
  g.beginPath();
  g.moveTo(EDGE, RADIUS);
  g.arcTo(EDGE, EDGE, RADIUS, EDGE, r);
  g.lineTo(w - RADIUS, EDGE);
  g.arcTo(w - EDGE, EDGE, w - EDGE, RADIUS, r);
  g.lineTo(w / 2, d);
  g.closePath();
  const fill = g.createLinearGradient(0, 0, 0, d);
  fill.addColorStop(0, '#12244a');
  fill.addColorStop(1, '#1b3566');
  g.fillStyle = fill;
  g.shadowColor = 'rgba(0, 0, 0, 0.45)';
  g.shadowBlur = 8 * s;
  g.shadowOffsetY = 2 * s;
  g.fill();
  g.restore();
  g.beginPath();
  g.moveTo(EDGE, RADIUS);
  g.lineTo(w / 2, d);
  g.lineTo(w - EDGE, RADIUS);
  g.strokeStyle = GOLD;
  g.lineWidth = EDGE;
  g.lineJoin = 'round';
  g.stroke();
}

/** A round gold seal with a gift pressed into it, centred on (x, y). */
function drawSeal(g: CanvasRenderingContext2D, x: number, y: number) {
  const s = g.getTransform().a;
  g.save();
  const fill = g.createRadialGradient(x - SEAL * 0.35, y - SEAL * 0.4, 1, x, y, SEAL);
  fill.addColorStop(0, '#fff1c4');
  fill.addColorStop(0.45, '#f2c14e');
  fill.addColorStop(1, '#c28a24');
  g.fillStyle = fill;
  g.shadowColor = 'rgba(0, 0, 0, 0.4)';
  g.shadowBlur = 6 * s;
  g.shadowOffsetY = 2 * s;
  g.beginPath();
  g.arc(x, y, SEAL, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(122, 76, 12, 0.45)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(x, y, SEAL - 3.5, 0, Math.PI * 2);
  g.stroke();
  g.save();
  g.translate(x - 12 * 0.85, y - 12 * 0.85);
  g.scale(0.85, 0.85);
  g.strokeStyle = '#6e4510';
  g.lineWidth = 1.8;
  g.lineCap = g.lineJoin = 'round';
  g.stroke(new Path2D(GLYPH));
  g.restore();
}

// Gift <-> URL fragment payload. Pure functions, no DOM, so they run in Node tests.
//
// Layout (version 1), then base64url:
//   [0]      version
//   [1]      field mask (bit i set = field i present, order of FIELDS)
//   [2]      paper: pattern(3) << 5 | scale(2) << 3 | finish(2) << 1
//   [3..5]   paper base rgb
//   [6..8]   paper accent rgb
//   [9]      ribbon: bow(2) << 6 | width(2) << 4 | finish(2) << 2
//   [10..12] ribbon rgb
//   ...      present fields: varint byte length + UTF-8
//   [-2..-1] checksum (16-bit FNV-1a fold) over everything before it

export const VERSION = 1;

export const PATTERNS = ['snowflake', 'stripe', 'plaid', 'pine', 'star', 'dot', 'holly', 'plain'] as const;
export const PAPER_FINISHES = ['matte', 'gloss', 'foil'] as const;
export const BOWS = ['classic', 'rosette', 'simple'] as const;
export const RIBBON_FINISHES = ['satin', 'velvet', 'metallic'] as const;

export type Rgb = [number, number, number];

export interface PaperStyle {
  pattern: number; // index into PATTERNS
  scale: number; // 0..3
  finish: number; // index into PAPER_FINISHES
  base: Rgb;
  accent: Rgb;
}

export interface RibbonStyle {
  bow: number; // index into BOWS
  width: number; // 0..2
  finish: number; // index into RIBBON_FINISHES
  color: Rgb;
}

export interface Gift {
  from: string;
  to: string;
  title: string;
  code: string;
  image: string;
  paper: PaperStyle;
  ribbon: RibbonStyle;
}

export const FIELDS = ['from', 'to', 'title', 'code', 'image'] as const;
export type Field = (typeof FIELDS)[number];

/** Maximum lengths, in characters (code points). */
export const LIMITS: Record<Field, number> = { from: 40, to: 40, title: 80, code: 80, image: 1024 };

/** Links longer than this are refused: some apps cut long links. */
export const MAX_LINK_LENGTH = 2000;

export const DEFAULT_GIFT: Gift = {
  from: '',
  to: '',
  title: '',
  code: '',
  image: '',
  paper: { pattern: 0, scale: 1, finish: 0, base: [176, 30, 42], accent: [246, 233, 204] },
  ribbon: { bow: 0, width: 1, finish: 0, color: [226, 182, 74] },
};

export function cloneGift(g: Gift): Gift {
  return {
    ...g,
    paper: { ...g.paper, base: [...g.paper.base], accent: [...g.paper.accent] },
    ribbon: { ...g.ribbon, color: [...g.ribbon.color] },
  };
}

const utf8 = new TextEncoder();
const utf8d = new TextDecoder('utf-8', { fatal: true });

function checksum(bytes: Uint8Array, end: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < end; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h >>> 16) ^ h) & 0xffff;
}

const clampInt = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(Number.isFinite(v) ? v : 0)));
const byte = (v: number) => clampInt(v, 255);

/** Trims and cuts a field to its limit, counting code points so emoji are never split. */
export function cleanField(field: Field, value: string): string {
  const chars = Array.from(value.trim());
  return chars.length > LIMITS[field] ? chars.slice(0, LIMITS[field]).join('') : chars.join('');
}

/** Only absolute https URLs are accepted as images. */
export function isImageUrl(value: string): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

export function encodeGift(g: Gift): string {
  const out: number[] = [VERSION, 0];
  const p = g.paper;
  const r = g.ribbon;
  out.push((clampInt(p.pattern, 7) << 5) | (clampInt(p.scale, 3) << 3) | (clampInt(p.finish, 2) << 1));
  out.push(...p.base.map(byte), ...p.accent.map(byte));
  out.push((clampInt(r.bow, 2) << 6) | (clampInt(r.width, 2) << 4) | (clampInt(r.finish, 2) << 2));
  out.push(...r.color.map(byte));
  let mask = 0;
  FIELDS.forEach((f, i) => {
    let value = cleanField(f, g[f]);
    if (f === 'image' && !isImageUrl(value)) value = '';
    if (!value) return;
    mask |= 1 << i;
    const bytes = utf8.encode(value);
    let n = bytes.length;
    while (n > 127) {
      out.push((n & 127) | 128);
      n >>>= 7;
    }
    out.push(n);
    for (const b of bytes) out.push(b);
  });
  out[1] = mask;
  const bytes = new Uint8Array(out.length + 2);
  bytes.set(out);
  const sum = checksum(bytes, out.length);
  bytes[out.length] = sum >> 8;
  bytes[out.length + 1] = sum & 255;
  return toBase64Url(bytes);
}

export type DecodeResult = { ok: true; gift: Gift } | { ok: false; reason: 'empty' | 'corrupt' | 'version' };

export function decodeGift(payload: string): DecodeResult {
  const text = payload.replace(/^#/, '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const bytes = fromBase64Url(text);
  if (!bytes || bytes.length < 15) return { ok: false, reason: 'corrupt' };
  if (bytes[0] !== VERSION) return { ok: false, reason: bytes[0] > VERSION ? 'version' : 'corrupt' };
  const end = bytes.length - 2;
  if (checksum(bytes, end) !== ((bytes[end] << 8) | bytes[end + 1])) return { ok: false, reason: 'corrupt' };

  const gift = cloneGift(DEFAULT_GIFT);
  const mask = bytes[1];
  gift.paper = {
    pattern: bytes[2] >> 5,
    scale: (bytes[2] >> 3) & 3,
    finish: Math.min(2, (bytes[2] >> 1) & 3),
    base: [bytes[3], bytes[4], bytes[5]],
    accent: [bytes[6], bytes[7], bytes[8]],
  };
  gift.ribbon = {
    bow: Math.min(2, bytes[9] >> 6),
    width: Math.min(2, (bytes[9] >> 4) & 3),
    finish: Math.min(2, (bytes[9] >> 2) & 3),
    color: [bytes[10], bytes[11], bytes[12]],
  };
  let at = 13;
  for (let i = 0; i < FIELDS.length; i++) {
    if (!(mask & (1 << i))) continue;
    let n = 0;
    let shift = 0;
    for (;;) {
      if (at >= end || shift > 21) return { ok: false, reason: 'corrupt' };
      const b = bytes[at++];
      n |= (b & 127) << shift;
      shift += 7;
      if (!(b & 128)) break;
    }
    if (at + n > end) return { ok: false, reason: 'corrupt' };
    let value: string;
    try {
      value = utf8d.decode(bytes.subarray(at, at + n));
    } catch {
      return { ok: false, reason: 'corrupt' };
    }
    at += n;
    const f = FIELDS[i];
    value = cleanField(f, value);
    gift[f] = f === 'image' && !isImageUrl(value) ? '' : value;
  }
  if (at !== end) return { ok: false, reason: 'corrupt' };
  return { ok: true, gift };
}

/** Builds the unwrap link relative to the wrap page's own address (works under any subpath). */
export function giftLink(g: Gift, wrapPageHref: string): string {
  const url = new URL('open/', wrapPageHref);
  url.search = '';
  url.hash = encodeGift(g);
  return url.href;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export const hex = (c: Rgb) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string): Rgb => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

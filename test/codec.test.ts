import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GIFT,
  LIMITS,
  MAX_LINK_LENGTH,
  cloneGift,
  decodeGift,
  encodeGift,
  giftLink,
  isImageUrl,
  type Gift,
} from '../src/codec/gift';

const full: Gift = {
  from: 'Grandma',
  to: 'Zoë 🎄',
  title: 'クリスマスプレゼント',
  code: 'ABCD-EFGH-IJKL',
  image: 'https://example.com/a.png?x=1&y=2',
  paper: { pattern: 6, scale: 3, finish: 2, base: [1, 2, 3], accent: [250, 251, 252] },
  ribbon: { bow: 2, width: 0, finish: 1, color: [10, 20, 30] },
};

describe('codec', () => {
  it('round-trips every field and style', () => {
    const r = decodeGift(encodeGift(full));
    expect(r).toEqual({ ok: true, gift: full });
  });

  it('round-trips an empty gift in a short payload', () => {
    const payload = encodeGift(DEFAULT_GIFT);
    expect(payload.length).toBeLessThan(24);
    expect(decodeGift(payload)).toEqual({ ok: true, gift: DEFAULT_GIFT });
  });

  it('accepts a leading #', () => {
    expect(decodeGift('#' + encodeGift(full)).ok).toBe(true);
  });

  it('drops non-https image URLs', () => {
    for (const image of ['javascript:alert(1)', 'http://example.com/a.png', 'data:image/png;base64,AAAA', 'not a url']) {
      const g = { ...cloneGift(full), image };
      const r = decodeGift(encodeGift(g));
      expect(r.ok && r.gift.image).toBe('');
    }
    expect(isImageUrl('https://example.com/a.png')).toBe(true);
  });

  it('trims and caps fields by code points', () => {
    const g = { ...cloneGift(DEFAULT_GIFT), title: '  ' + '🎁'.repeat(LIMITS.title + 5) + '  ' };
    const r = decodeGift(encodeGift(g));
    expect(r.ok && Array.from(r.gift.title).length).toBe(LIMITS.title);
  });

  it('keeps line breaks inside the message', () => {
    const g = { ...cloneGift(DEFAULT_GIFT), title: 'Merry Christmas!\nLove,\nBrandon\n' };
    const r = decodeGift(encodeGift(g));
    expect(r.ok && r.gift.title).toBe('Merry Christmas!\nLove,\nBrandon');
  });

  it('rejects every truncation and every single-character change', () => {
    const payload = encodeGift(full);
    for (let n = 0; n < payload.length; n++) expect(decodeGift(payload.slice(0, n)).ok).toBe(false);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let accepted = 0;
    for (let i = 0; i < payload.length; i++) {
      const c = alphabet[(alphabet.indexOf(payload[i]) + 17) % 64];
      if (decodeGift(payload.slice(0, i) + c + payload.slice(i + 1)).ok) accepted++;
    }
    // A 16-bit checksum lets roughly 1 in 65k random edits through; none here.
    expect(accepted).toBe(0);
  });

  it('reports newer versions separately', () => {
    const bytes = Uint8Array.from(atob(encodeGift(full).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    bytes[0] = 9;
    const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeGift(payload)).toEqual({ ok: false, reason: 'version' });
  });

  it('never throws on random input', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 3000; i++) {
      const s = Array.from({ length: (rnd() * 80) | 0 }, () => String.fromCharCode(32 + ((rnd() * 95) | 0))).join('');
      expect(() => decodeGift(s)).not.toThrow();
    }
  });

  it('keeps a maxed-out gift under the link limit', () => {
    const g: Gift = {
      ...cloneGift(full),
      from: 'é'.repeat(LIMITS.from),
      to: 'é'.repeat(LIMITS.to),
      title: 'é'.repeat(LIMITS.title),
      code: 'é'.repeat(LIMITS.code),
      image: 'https://example.com/' + 'a'.repeat(300),
    };
    expect(giftLink(g, 'https://someone.github.io/giftwrap/').length).toBeLessThan(MAX_LINK_LENGTH);
  });

  it('keeps every field maxed with 4-byte characters under the link limit, image aside', () => {
    const g: Gift = {
      ...cloneGift(full),
      from: '🎁'.repeat(LIMITS.from),
      to: '🎁'.repeat(LIMITS.to),
      title: '🎁'.repeat(LIMITS.title),
      code: '🎁'.repeat(LIMITS.code),
      image: '',
    };
    expect(giftLink(g, 'https://someone.github.io/giftwrap/').length).toBeLessThan(MAX_LINK_LENGTH);
  });

  it('builds links next to the wrap page, under any subpath', () => {
    expect(giftLink(DEFAULT_GIFT, 'https://someone.github.io/giftwrap/?x=1#old')).toMatch(
      /^https:\/\/someone\.github\.io\/giftwrap\/open\/#[A-Za-z0-9_-]+$/,
    );
    expect(giftLink(DEFAULT_GIFT, 'http://localhost:5179/index.html')).toMatch(/^http:\/\/localhost:5179\/open\/#/);
  });
});

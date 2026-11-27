import '../ui/style.css';
import {
  DEFAULT_GIFT,
  MAX_LINK_LENGTH,
  PATTERNS,
  cloneGift,
  fromHex,
  giftLink,
  hex,
  isImageUrl,
  type Gift,
  type Rgb,
} from '../codec/gift';
import { Celebration } from '../scene/celebration';
import { GiftView } from '../scene/giftView';
import { attachInteraction } from '../scene/interaction';
import { drawPattern } from '../scene/patterns';
import { detectTier, prefersReducedMotion, Stage, webglAvailable } from '../scene/stage';
import { GIFT, TOP } from '../sim/dims';
import { World } from '../sim/world';
import { icons } from '../ui/icons';
import { $, copyButton, fillTag, hideLoader, pinToScene } from '../ui/shared';

const DRAFT_KEY = 'giftwrap:draft';

const PAPER_PALETTES: [Rgb, Rgb][] = [
  [[176, 30, 42], [246, 233, 204]],
  [[24, 84, 58], [233, 191, 94]],
  [[22, 40, 82], [214, 222, 235]],
  [[178, 134, 92], [250, 246, 238]],
  [[244, 239, 230], [190, 30, 45]],
  [[212, 170, 82], [110, 20, 36]],
  [[92, 20, 40], [240, 200, 120]],
  [[34, 96, 112], [245, 236, 214]],
];
const RIBBON_COLORS: Rgb[] = [[226, 182, 74], [200, 16, 46], [246, 240, 228], [30, 110, 76], [200, 206, 218], [120, 18, 40]];

const gift = loadDraft();
const form = $('#form') as HTMLFormElement;
const input = (id: string) => $('#' + id) as HTMLInputElement;
const textFields = ['from', 'to', 'title', 'code', 'image'] as const;

// --- 3D preview ---------------------------------------------------------------
let world: World | null = null;
let view: GiftView | null = null;
let party: Celebration | null = null;
const tag = $('#tag');
const canvas = $('#scene') as HTMLCanvasElement;
let stage: Stage | null = null;

const tier = detectTier();
try {
  // Throws when the browser refuses a context (Chrome blocks WebGL for a site after a GPU reset).
  if (webglAvailable()) stage = new Stage(canvas, { tier, fitRadius: 2.5, autoRotate: !prefersReducedMotion() });
} catch {
  stage = null;
}
if (stage) {
  const w = new World({ detail: tier, ornaments: tier === 'high' ? 70 : 55, bow: gift.ribbon.bow, ribbonWidth: gift.ribbon.width, unwrappable: false });
  world = w;
  view = new GiftView(stage.scene, w, tier);
  party = new Celebration(stage, prefersReducedMotion());
  attachInteraction(stage, view, () => w, { onFirstTouch: () => stage && (stage.controls.autoRotate = false) });
  const tagPoint: [number, number, number] = [GIFT.hx * 0.35, TOP - 0.3, GIFT.hz];
  let acc = 0;
  stage.onFrame((dt) => {
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n < 3) {
      w.step(1 / 60);
      acc -= 1 / 60;
      n++;
    }
    if (n === 3) acc = 0;
    view!.sync(dt);
    if (!tag.hidden) pinToScene(tag, canvas, stage!.camera, tagPoint);
  });
  // The form works without the preview. Hide the blank canvas (and the tag pinned to it) until the
  // context comes back, but keep its space so the form does not jump while someone types.
  const preview = $('.preview');
  stage.onContext({
    lost: () => (preview.style.visibility = 'hidden'),
    restored: () => (preview.style.visibility = ''),
  });
  holdThroughKeyboardBlips(preview);
  void stage.start().then(() => hideLoader());
} else {
  $('.preview').hidden = true;
}

/**
 * Chrome on Android shows a bar of autofill shortcuts above the keyboard and drops it for a moment each
 * time focus moves to another field. With interactive-widget=resizes-content (see index.html) the page
 * grows by the bar's height and shrinks back within a fifth of a second; following that resizes the
 * preview twice, which refits the camera and shifts the form. So in the phone layout, while someone is
 * typing, a small growth leaves the preview's height alone (the form takes the room). The preview
 * follows the page again once it shrinks back or grows by a keyboard's height, its width or layout
 * changes, or it resizes while no field has focus.
 */
function holdThroughKeyboardBlips(el: HTMLElement) {
  if (!matchMedia('(pointer: coarse)').matches) return;
  /** The phone layout in style.css: the preview on top, the form scrolling under it. */
  const STACKED = '(max-width: 860px) and (min-height: 501px), (max-width: 599px)';
  const stacked = matchMedia(STACKED);
  /** Well over the bar's height, well under a keyboard's. */
  const SMALL = 150;
  let height = el.getBoundingClientRect().height;
  let base = { width: innerWidth, height: innerHeight, stacked: stacked.matches };
  let held = false;
  // Reported after each layout that changes it, so the resize handler has the height from before the
  // resize (measuring there would lay the page out for the new size).
  new ResizeObserver(([e]) => {
    if (!held) height = e.borderBoxSize[0].blockSize;
  }).observe(el);
  addEventListener('resize', () => {
    const a = document.activeElement;
    const typing = a instanceof HTMLInputElement && (a.type === 'text' || a.type === 'url') && !a.readOnly;
    const growth = innerHeight - base.height;
    if (typing && base.stacked && stacked.matches && innerWidth === base.width && growth > 0 && growth < SMALL) {
      held = true;
      el.style.height = `${height}px`;
      return;
    }
    held = false;
    el.style.height = '';
    base = { width: innerWidth, height: innerHeight, stacked: stacked.matches };
  });
}

// --- Controls -----------------------------------------------------------------
$('#logo').innerHTML = icons.gift;
$('#create-icon').innerHTML = icons.gift;
($('#shuffle') as HTMLButtonElement).innerHTML = icons.dice;

const patternBox = $('#patterns');
PATTERNS.forEach((name, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.dataset.pattern = String(i);
  b.setAttribute('aria-label', name);
  b.title = name;
  b.addEventListener('click', () => {
    gift.paper.pattern = i;
    changed();
  });
  patternBox.append(b);
});

const finishChips = (box: HTMLElement, names: string[], key: 'paper' | 'ribbon') => {
  names.forEach((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.finish = String(i);
    b.setAttribute('aria-label', name);
    b.title = name;
    b.addEventListener('click', () => {
      gift[key].finish = i;
      changed();
    });
    box.append(b);
  });
};
finishChips($('#paper-finish'), ['Matte', 'Gloss', 'Foil'], 'paper');
finishChips($('#ribbon-finish'), ['Satin', 'Velvet', 'Metallic'], 'ribbon');

const bowBox = $('#bows');
[icons.bowClassic, icons.bowRosette, icons.bowSimple].forEach((svg, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.bow = String(i);
  b.innerHTML = svg;
  const name = ['Classic bow', 'Rosette', 'Simple bow'][i];
  b.setAttribute('aria-label', name);
  b.title = name;
  b.addEventListener('click', () => {
    gift.ribbon.bow = i;
    changed(true);
  });
  bowBox.append(b);
});

for (const f of textFields) {
  input(f).value = gift[f];
  input(f).addEventListener('input', () => {
    gift[f] = input(f).value;
    if (f === 'image') checkImage();
    changed();
  });
}
input('paper-base').addEventListener('input', (e) => {
  gift.paper.base = fromHex((e.target as HTMLInputElement).value);
  changed();
});
input('paper-accent').addEventListener('input', (e) => {
  gift.paper.accent = fromHex((e.target as HTMLInputElement).value);
  changed();
});
input('ribbon-color').addEventListener('input', (e) => {
  gift.ribbon.color = fromHex((e.target as HTMLInputElement).value);
  changed();
});
input('paper-scale').addEventListener('input', (e) => {
  gift.paper.scale = +(e.target as HTMLInputElement).value;
  changed();
});
input('ribbon-width').addEventListener('input', (e) => {
  gift.ribbon.width = +(e.target as HTMLInputElement).value;
  changed(true);
});

$('#shuffle').addEventListener('click', () => {
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const [base, accent] = pick(PAPER_PALETTES);
  gift.paper = { pattern: Math.floor(Math.random() * 7), scale: Math.floor(Math.random() * 4), finish: pick([0, 0, 1, 2]), base: [...base], accent: [...accent] };
  gift.ribbon = { bow: Math.floor(Math.random() * 3), width: Math.floor(Math.random() * 3), finish: pick([0, 0, 1, 2]), color: [...pick(RIBBON_COLORS)] };
  changed(true);
});

// --- Image check --------------------------------------------------------------
const imageField = $('#image-field');
const imageNote = $('#image-note');
const thumb = $('#thumb') as HTMLImageElement;
let imageTimer = 0;
let imageOk = true;

function setImageState(state: 'ok' | 'bad' | 'empty', note = '') {
  imageOk = state !== 'bad';
  if (state === 'bad') imageField.dataset.state = 'bad';
  else delete imageField.dataset.state;
  imageNote.hidden = !note;
  imageNote.innerHTML = note ? icons.warn : '';
  if (note) imageNote.append(note);
  if (state !== 'ok') thumb.hidden = true;
}

function checkImage() {
  clearTimeout(imageTimer);
  const url = gift.image.trim();
  if (!url) return setImageState('empty');
  if (!isImageUrl(url)) return setImageState('bad', 'Needs https://');
  imageTimer = window.setTimeout(() => {
    thumb.onload = () => {
      if (gift.image.trim() !== url) return;
      thumb.hidden = false;
      setImageState('ok');
    };
    thumb.onerror = () => {
      if (gift.image.trim() !== url) return;
      setImageState('bad', 'Image won’t load');
    };
    thumb.src = url;
  }, 350);
}

// --- Create -------------------------------------------------------------------
const result = $('#result');
const linkInput = input('link');
const errorBox = $('#form-error');
const linkWarning = $('#link-warning');
const openLink = $('#open-link') as HTMLAnchorElement;
openLink.innerHTML = icons.open;
copyButton($('#copy-link') as HTMLButtonElement, () => linkInput.value);
const shareBtn = $('#share-link') as HTMLButtonElement;
shareBtn.innerHTML = icons.share;
if (typeof navigator.share === 'function') {
  shareBtn.hidden = false;
  shareBtn.addEventListener('click', () => {
    navigator.share({ url: linkInput.value }).catch(() => {});
  });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  errorBox.hidden = true;
  if (gift.image.trim() && !isImageUrl(gift.image.trim())) {
    setImageState('bad', 'Needs https://');
    input('image').focus();
    return;
  }
  const link = giftLink(gift, location.href);
  if (link.length > MAX_LINK_LENGTH) {
    errorBox.textContent = 'Too long for a link. Try a shorter image URL.';
    errorBox.hidden = false;
    return;
  }
  linkInput.value = link;
  openLink.href = link;
  // A gift card number in the link makes the link itself worth guarding.
  linkWarning.hidden = !gift.code.trim();
  // Focus goes to the link, so a screen reader hears the warning with it.
  if (linkWarning.hidden) linkInput.removeAttribute('aria-describedby');
  else linkInput.setAttribute('aria-describedby', 'link-warning');
  result.hidden = false;
  if (!imageOk) {
    errorBox.textContent = 'The image may not show.';
    errorBox.hidden = false;
  }
  world?.wiggle();
  party?.play('small', world ? [world.ribbon.knot[0], world.ribbon.knot[1] + 0.2, world.ribbon.knot[2]] : [0, TOP, 0]);
  result.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  linkInput.focus({ preventScroll: true });
  linkInput.select();
});

// --- Sync ---------------------------------------------------------------------
function changed(ribbonShape = false) {
  result.hidden = true;
  linkWarning.hidden = true;
  errorBox.hidden = true;
  if (world && view && ribbonShape) {
    world.setRibbon(gift.ribbon.bow, gift.ribbon.width);
    view.buildRibbonMesh();
  }
  render();
  saveDraft();
}

const swatchCanvas = document.createElement('canvas');
function render() {
  view?.setPaper(gift.paper);
  view?.setRibbon(gift.ribbon);
  tag.hidden = !fillTag(tag, gift.to.trim(), gift.from.trim());

  patternBox.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b) => {
    const i = +b.dataset.pattern!;
    b.setAttribute('aria-pressed', String(i === gift.paper.pattern));
    const key = `${i}|${gift.paper.base}|${gift.paper.accent}`;
    if (b.dataset.key !== key) {
      drawPattern(swatchCanvas, i, gift.paper.base, gift.paper.accent, 128);
      b.style.backgroundImage = `url(${swatchCanvas.toDataURL()})`;
      b.dataset.key = key;
    }
  });
  const finishLook = (box: HTMLElement, c: Rgb, current: number) =>
    box.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => {
      const i = +b.dataset.finish!;
      b.setAttribute('aria-pressed', String(i === current));
      const h = hex(c);
      b.style.background = [
        h,
        `radial-gradient(circle at 32% 28%, #ffffffcc 0 12%, transparent 30%), ${h}`,
        `linear-gradient(135deg, #ffffffaa, ${h} 35%, #00000066 60%, ${h} 80%, #ffffffaa)`,
      ][i];
    });
  finishLook($('#paper-finish'), gift.paper.base, gift.paper.finish);
  finishLook($('#ribbon-finish'), gift.ribbon.color, gift.ribbon.finish);
  bowBox.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.bow! === gift.ribbon.bow)));

  input('paper-base').value = hex(gift.paper.base);
  input('paper-accent').value = hex(gift.paper.accent);
  input('ribbon-color').value = hex(gift.ribbon.color);
  input('paper-scale').value = String(gift.paper.scale);
  input('ribbon-width').value = String(gift.ribbon.width);
}

function loadDraft(): Gift {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Gift>;
      const g = cloneGift(DEFAULT_GIFT);
      for (const f of ['from', 'to', 'title', 'code', 'image'] as const) if (typeof d[f] === 'string') g[f] = d[f];
      if (d.paper) Object.assign(g.paper, d.paper);
      if (d.ribbon) Object.assign(g.ribbon, d.ribbon);
      return g;
    }
  } catch {
    // Private mode or bad data: start fresh.
  }
  return cloneGift(DEFAULT_GIFT);
}

let saveTimer = 0;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      // The code is left out: it can be a real gift card number on a shared computer.
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...gift, code: '' }));
    } catch {
      // Storage unavailable; the draft just is not kept.
    }
  }, 300);
}

render();
checkImage();

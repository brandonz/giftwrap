import '../ui/style.css';
import { decodeGift, type Gift } from '../codec/gift';
import { Celebration } from '../scene/celebration';
import { GiftView } from '../scene/giftView';
import { attachInteraction } from '../scene/interaction';
import { Letter } from '../scene/letter';
import { detectTier, prefersReducedMotion, Stage, webglAvailable } from '../scene/stage';
import { GIFT, TOP } from '../sim/dims';
import { World } from '../sim/world';
import { envelopeArt, openEnvelope } from '../ui/envelope';
import { icons } from '../ui/icons';
import { $, copyButton, fillTag, hideLoader, pinToScene, seedFrom } from '../ui/shared';

const payload = location.hash.slice(1);
/** The gift's image, fetched from the start: 'none' when the gift has none. */
let image: 'none' | 'loading' | 'ready' | 'failed' = 'none';
/** Set once the 3D gift is drawn (or there is none): decoding the image waits for that. */
let decodeImage = false;
/** The card is filled in (it may still be hidden). */
let filled = false;
/** The card is up and open: its size is free to change. */
let cardOpen = false;
// A different gift pasted into the same tab only changes the hash; start over with it.
window.addEventListener('hashchange', () => location.reload());
if (!payload) {
  // Nothing to open: go and make one.
  location.replace('../');
} else {
  const result = decodeGift(payload);
  if (!result.ok) showMessage(result.reason === 'version' ? 'This gift needs a newer page. Try reloading.' : 'This link is broken.');
  else {
    preloadImage(result.gift);
    // Without WebGL, or when the browser refuses a context (Chrome blocks WebGL for a site after a
    // GPU reset), the gift still opens: a flat one.
    if (!webglAvailable() || !start(result.gift, payload)) flatGift(result.gift);
  }
}

/** Runs the 3D gift. False if WebGL could not start. */
function start(gift: Gift, payload: string): boolean {
  const tier = detectTier();
  const reduced = prefersReducedMotion();
  const canvas = $('#scene') as HTMLCanvasElement;
  let stage: Stage;
  try {
    stage = new Stage(canvas, { tier, fitRadius: 2.7 });
  } catch {
    return false;
  }
  const world = new World({
    detail: tier,
    ornaments: tier === 'high' ? 90 : 65,
    bow: gift.ribbon.bow,
    ribbonWidth: gift.ribbon.width,
    unwrappable: true,
    seed: seedFrom(payload),
  });
  const view = new GiftView(stage.scene, world, tier);
  view.setPaper(gift.paper);
  view.setRibbon(gift.ribbon);
  const party = new Celebration(stage, reduced);
  const letter = new Letter(stage);

  const tag = $('#tag');
  const hasTag = fillTag(tag, gift.to, gift.from);
  tag.hidden = !hasTag;
  const tagPoint: [number, number, number] = [GIFT.hx * 0.35, TOP - 0.3, GIFT.hz];

  let touched = false;
  attachInteraction(stage, view, () => world, { onFirstTouch: () => (touched = true) });

  world.events.untie = () => {
    tag.hidden = true;
  };
  world.events.open = () => {
    party.play('big', [0, TOP - 0.1, 0]);
    // The flat gift is up (the world steps on while the context is lost, and can open by itself) or was
    // opened already: nothing to rise in. reveal() leaves a card that is already up alone.
    if (canvas.hidden || !$('#reveal').hidden) return reveal(gift, null);
    if (reduced) {
      setTimeout(() => reveal(gift, null), 300);
      return;
    }
    // The card rises out of the box sealed in an envelope of its own shape, then the page's card takes
    // its place on screen.
    try {
      const size = measureCard(gift);
      // At the swap the 3D card is about 60% of the page card's size: no need for more texels than that.
      const art = envelopeArt(size.width, size.height, Math.max(1, 0.6 * stage.renderer.getPixelRatio()));
      void letter.rise(art, size.width / size.height).then((box) => reveal(gift, box));
    } catch {
      // A canvas refused (iOS under memory pressure): the card comes without its envelope.
      reveal(gift, null);
      return;
    }
    // A background tab draws no frames: bring the card anyway.
    setTimeout(() => letter.land(), 2500);
  };

  // A nudge from the bow until someone touches the gift.
  let hintAt = 2.5;
  let simTime = 0;
  let acc = 0;
  const STEP = 1 / 60;
  stage.onFrame((dt) => {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 3) {
      world.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 3) acc = 0;
    simTime += dt;
    if (!touched && world.phase === 'tied' && simTime > hintAt) {
      world.wiggle();
      hintAt = simTime + 3.5;
    }
    view.sync(dt);
    if (!tag.hidden) pinToScene(tag, canvas, stage.camera, tagPoint);
  });
  // A lost context leaves a blank canvas (or the browser's broken-canvas icon). Show the flat gift
  // until it comes back; if it never does, the flat gift still opens.
  stage.onContext({
    lost: () => {
      tag.hidden = true;
      // Once open (in 3D, or from the flat gift), the card is shown or on its way; a wrapped flat gift
      // would undo the moment.
      if (world.phase === 'open' || !$('#reveal').hidden) {
        // A card still rising comes on now, from where it was (measured while the canvas is still shown).
        letter.land();
        canvas.hidden = true;
        return;
      }
      const hadFocus = document.activeElement === canvas || $('#message').contains(document.activeElement);
      const btn = flatGift(gift);
      if (hadFocus) btn.focus({ preventScroll: true });
    },
    restored: () => {
      // Opened from the flat gift: the 3D one behind the card would still be wrapped.
      if (!$('#reveal').hidden && world.phase !== 'open') return;
      const box = $('#message');
      const hadFocus = box.contains(document.activeElement);
      box.hidden = true;
      canvas.hidden = false;
      tag.hidden = !hasTag || world.phase !== 'tied';
      if (hadFocus) canvas.focus({ preventScroll: true });
    },
  });

  void stage.start().then(() => {
    hideLoader();
    warmImage();
  });
  canvas.focus({ preventScroll: true });
  return true;
}

/**
 * Shows the card. With motion, it flies in sealed from `from` (where the 3D card or the flat gift was)
 * and opens; without, it fades in open.
 */
function reveal(gift: Gift, from: DOMRect | null) {
  const card = $('#reveal');
  // The flat gift and the 3D one can both ask (a context lost while opening); the first one wins.
  if (!card.hidden) return;
  fillCard(gift);
  $('#message').hidden = true;
  card.hidden = false;
  if (from && !prefersReducedMotion() && openSealed(card, from)) return;
  card.animate({ opacity: [0, 1] }, { duration: 200, easing: 'ease-out' });
  cardOpened();
}

/** Brings the card in sealed and opens it. False if that could not start (a canvas refused): it fades in instead. */
function openSealed(card: HTMLElement, from: DOMRect): boolean {
  try {
    void openEnvelope(card, from).then(cardOpened);
    return true;
  } catch {
    return false;
  }
}

/** The card is in place and open: the image can take its own shape now. */
function cardOpened() {
  cardOpen = true;
  settleFrame();
}

/** The card's box once shown, measured without showing it. */
function measureCard(gift: Gift): DOMRect {
  fillCard(gift);
  const card = $('#reveal');
  card.style.visibility = 'hidden';
  card.hidden = false;
  const box = card.getBoundingClientRect();
  card.hidden = true;
  card.style.visibility = '';
  return box;
}

/** Fills the card from the gift, once: the 3D gift does it early, to measure the card. */
function fillCard(gift: Gift) {
  if (filled) return;
  filled = true;
  const names = $('#names');
  names.replaceChildren();
  for (const [label, value] of [
    ['To', gift.to],
    ['From', gift.from],
  ]) {
    if (!value) continue;
    const span = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = value;
    span.append(`${label} `, b);
    names.append(span);
  }
  names.hidden = !names.childElementCount;

  const title = $('#title');
  title.textContent = gift.title;
  title.hidden = !gift.title;

  // Usually here already. If not, a placeholder keeps its place until it is (see settleFrame).
  const frame = $('#image-frame');
  if (image === 'loading') frame.dataset.state = 'loading';
  frame.hidden = image === 'none' || image === 'failed';

  const codeRow = $('#code-row');
  $('#code').textContent = gift.code;
  codeRow.hidden = !gift.code;
  copyButton($('#copy') as HTMLButtonElement, () => gift.code);

  const replay = $('#replay') as HTMLButtonElement;
  replay.innerHTML = icons.replay;
  replay.onclick = () => location.reload();
  $('#make').innerHTML = icons.gift;
}

/**
 * Fetches the gift's image while the gift is still wrapped, so it is in the card the moment it opens
 * rather than popping in after.
 */
function preloadImage(gift: Gift) {
  if (!gift.image) return;
  image = 'loading';
  const img = $('#image') as HTMLImageElement;
  img.alt = gift.title || '';
  img.onload = () => {
    imageSettled(true);
    if (decodeImage) decode(img);
  };
  img.onerror = () => imageSettled(false);
  img.src = gift.image;
}

/**
 * Decodes the loaded image ahead of the card, so it is drawn in the card's first frame. Not before the
 * 3D gift is up: a large photo's bitmap on top of shader compiling is what resets phone GPUs.
 */
function warmImage() {
  decodeImage = true;
  if (image === 'ready') decode($('#image') as HTMLImageElement);
}

/** Best effort: a refusal only means the card decodes it when drawn, as before. */
function decode(img: HTMLImageElement) {
  img.decode().catch(() => {});
}

function imageSettled(ok: boolean) {
  image = ok ? 'ready' : 'failed';
  settleFrame();
}

/**
 * Once the image is in (or has failed) and the card is open with the placeholder, eases the frame to
 * the image's shape (or away) and fades the image in. Not before the card is open: it keeps its size
 * until then, as the 3D card that comes before it was shaped from it.
 */
function settleFrame() {
  const img = $('#image') as HTMLImageElement;
  const frame = $('#image-frame');
  // No placeholder (the image settled before the card was filled), the image still on its way, or the
  // card not open yet: imageSettled() or cardOpened() calls again.
  if (frame.dataset.state !== 'loading' || image === 'loading' || !cardOpen) return;
  const ok = image === 'ready';
  const from = frame.offsetHeight;
  // A broken image would draw its alt text and icon while the frame closes.
  img.hidden = !ok;
  delete frame.dataset.state;
  const to = ok ? frame.offsetHeight : 0;
  const done = () => (frame.hidden = !ok);
  if (prefersReducedMotion()) return done();
  frame.animate({ height: [`${from}px`, `${to}px`] }, { duration: 300, easing: 'ease-out' }).finished.then(done, done);
  if (ok) img.animate({ opacity: [0, 1] }, { duration: 300, delay: 150, fill: 'backwards' });
}

function showMessage(text: string) {
  const box = $('#message');
  const p = document.createElement('p');
  p.textContent = text;
  const a = document.createElement('a');
  a.className = 'icon-btn';
  a.href = '../';
  a.setAttribute('aria-label', 'Wrap a gift');
  a.title = 'Wrap a gift';
  a.innerHTML = icons.gift;
  box.replaceChildren(p, a);
  box.hidden = false;
  $('#scene').hidden = true;
  hideLoader(false);
}

/** No WebGL: a flat gift that opens on tap. Returns its button. */
function flatGift(gift: Gift): HTMLButtonElement {
  const box = $('#message');
  const btn = document.createElement('button');
  btn.className = 'flat-gift';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open gift');
  btn.onclick = () => {
    // The card comes out of where the gift was.
    const from = btn.getBoundingClientRect();
    box.hidden = true;
    reveal(gift, from);
  };
  // Without a label it reads as a picture, not something to tap. The button has its own aria-label.
  const hint = document.createElement('p');
  hint.className = 'flat-hint';
  hint.textContent = matchMedia('(pointer: coarse)').matches ? 'Tap to open' : 'Click to open';
  hint.setAttribute('aria-hidden', 'true');
  hint.onclick = () => btn.click();
  box.replaceChildren(btn, hint);
  box.hidden = false;
  $('#scene').hidden = true;
  hideLoader(false);
  warmImage();
  return btn;
}

import '../ui/style.css';
import { decodeGift, type Gift } from '../codec/gift';
import { Celebration } from '../scene/celebration';
import { GiftView } from '../scene/giftView';
import { attachInteraction } from '../scene/interaction';
import { detectTier, prefersReducedMotion, Stage, webglAvailable } from '../scene/stage';
import { GIFT, TOP } from '../sim/dims';
import { World } from '../sim/world';
import { icons } from '../ui/icons';
import { $, copyButton, fillTag, pinToScene, seedFrom } from '../ui/shared';

const payload = location.hash.slice(1);
// A different gift pasted into the same tab only changes the hash; start over with it.
window.addEventListener('hashchange', () => location.reload());
if (!payload) {
  // Nothing to open: go and make one.
  location.replace('../');
} else {
  const result = decodeGift(payload);
  if (!result.ok) showMessage(result.reason === 'version' ? 'This gift needs a newer page. Try reloading.' : 'This link is broken.');
  // Without WebGL, or when the browser refuses a context (Chrome blocks WebGL for a site after a
  // GPU reset), the gift still opens: a flat one.
  else if (!webglAvailable() || !start(result.gift, payload)) flatGift(result.gift);
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
    setTimeout(() => reveal(gift), reduced ? 300 : 1400);
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
      if ($('#reveal').hidden) flatGift(gift);
      else canvas.hidden = true;
    },
    restored: () => {
      // Opened from the flat gift: the 3D one behind the card would still be wrapped.
      if (!$('#reveal').hidden && world.phase !== 'open') return;
      $('#message').hidden = true;
      canvas.hidden = false;
      tag.hidden = !hasTag || world.phase !== 'tied';
    },
  });

  void stage.start();
  canvas.focus({ preventScroll: true });
  return true;
}

function reveal(gift: Gift) {
  const card = $('#reveal');
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

  const img = $('#image') as HTMLImageElement;
  if (gift.image) {
    img.onerror = () => (img.hidden = true);
    img.onload = () => (img.hidden = false);
    img.alt = gift.title || '';
    img.src = gift.image;
  }

  const codeRow = $('#code-row');
  $('#code').textContent = gift.code;
  codeRow.hidden = !gift.code;
  copyButton($('#copy') as HTMLButtonElement, () => gift.code);

  const replay = $('#replay') as HTMLButtonElement;
  replay.innerHTML = icons.replay;
  replay.onclick = () => location.reload();
  $('#make').innerHTML = icons.gift;

  $('#message').hidden = true;
  card.hidden = false;
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
}

/** No WebGL: a flat gift that opens on tap. */
function flatGift(gift: Gift) {
  const box = $('#message');
  const btn = document.createElement('button');
  btn.className = 'flat-gift';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open gift');
  btn.onclick = () => {
    box.hidden = true;
    reveal(gift);
  };
  // Without a label it reads as a picture, not something to tap.
  const hint = document.createElement('p');
  hint.textContent = 'Tap to open';
  hint.setAttribute('aria-hidden', 'true');
  box.replaceChildren(btn, hint);
  box.hidden = false;
  $('#scene').hidden = true;
}

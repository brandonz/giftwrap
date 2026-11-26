// Small DOM helpers shared by both pages.

import { Vector3, type PerspectiveCamera } from 'three';
import { icons } from './icons';

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as HTMLElement;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page not served over HTTPS.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Wires an icon button that copies `get()` and briefly shows a check. */
export function copyButton(btn: HTMLButtonElement, get: () => string) {
  btn.innerHTML = icons.copy;
  let timer = 0;
  btn.addEventListener('click', async () => {
    const ok = await copyText(get());
    btn.innerHTML = ok ? icons.check : icons.warn;
    btn.dataset.state = ok ? 'done' : 'fail';
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      btn.innerHTML = icons.copy;
      delete btn.dataset.state;
    }, 1600);
  });
}

/** Keeps a DOM element pinned to a point in the 3D scene. */
export function pinToScene(el: HTMLElement, canvas: HTMLCanvasElement, camera: PerspectiveCamera, point: [number, number, number]) {
  const v = new Vector3(...point).project(camera);
  const r = canvas.getBoundingClientRect();
  const x = (v.x * 0.5 + 0.5) * r.width;
  const y = (-v.y * 0.5 + 0.5) * r.height;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  el.dataset.pinned = '';
}

/** Fills a gift tag. Returns false when there is nothing to show. */
export function fillTag(el: HTMLElement, to: string, from: string): boolean {
  el.replaceChildren();
  const line = (label: string, value: string) => {
    if (!value) return;
    const row = document.createElement('div');
    const l = document.createElement('span');
    l.className = 'tag-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'tag-name';
    v.textContent = value;
    row.append(l, v);
    el.append(row);
  };
  line('To', to);
  line('From', from);
  return !!(to || from);
}

/** A stable seed from a string, so the same link always tears the same way. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000 || 7;
}

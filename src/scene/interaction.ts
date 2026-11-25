// Pointer and keyboard input: grab what is under the finger, otherwise orbit the camera.

import { Plane, Raycaster, Vector2, Vector3, type Intersection } from 'three';
import type { World } from '../sim/world';
import type { GiftView } from './giftView';
import type { Stage } from './stage';

export interface InteractionHooks {
  /** First time the person touches anything. */
  onFirstTouch?: () => void;
}

export function attachInteraction(stage: Stage, view: GiftView, getWorld: () => World, hooks: InteractionHooks = {}) {
  const canvas = stage.canvas;
  const ray = new Raycaster();
  const ndc = new Vector2();
  const plane = new Plane();
  const hit = new Vector3();
  const groundPlane = new Plane(new Vector3(0, 1, 0), -0.35);
  let active: number | null = null;
  let touched = false;
  let hoverUntil = 0;

  const setRay = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
  };

  const pick = (): { kind: 'paper' | 'ribbon' | 'ornament'; hit: Intersection } | null => {
    const w = getWorld();
    view.refreshBounds();
    const targets = [view.ribbon, view.knot, view.paperFront, view.paperBack, view.ornaments, view.lid, view.base];
    const hits = ray.intersectObjects(targets, false);
    for (const h of hits) {
      if (h.object === view.lid || h.object === view.base) return null;
      if (h.object === view.ornaments) return { kind: 'ornament', hit: h };
      if (h.object === view.ribbon || h.object === view.knot) return { kind: 'ribbon', hit: h };
      if (w.phase === 'open') continue;
      // Before the ribbon is off, a tug on the paper wiggles it (it does not tear yet).
      return { kind: 'paper', hit: h };
    }
    return null;
  };

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (active !== null) return;
      setRay(e);
      const p = pick();
      if (!touched) {
        touched = true;
        hooks.onFirstTouch?.();
      }
      if (!p) return; // falls through to the orbit controls
      const w = getWorld();
      const ok = w.beginGrab(p.kind, p.hit.point.toArray(), p.hit.instanceId ?? -1);
      if (!ok) return;
      active = e.pointerId;
      stage.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      // Drag on a plane through the grabbed point, facing the camera.
      plane.setFromNormalAndCoplanarPoint(stage.camera.getWorldDirection(new Vector3()).negate(), p.hit.point);
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    { capture: true },
  );

  canvas.addEventListener('pointermove', (e) => {
    setRay(e);
    const w = getWorld();
    if (e.pointerId === active) {
      if (ray.ray.intersectPlane(plane, hit)) {
        hit.y = Math.max(0.05, hit.y);
        w.moveGrab(hit.toArray());
      }
      return;
    }
    // A mouse sweeping over the pit nudges the ornaments.
    if (e.pointerType === 'mouse' && active === null && ray.ray.intersectPlane(groundPlane, hit)) {
      const p = w.ornaments.pointer;
      p.x = hit.x;
      p.y = hit.y;
      p.z = hit.z;
      p.r = Math.hypot(hit.x, hit.z) > 1.3 ? 0.35 : 0;
      hoverUntil = performance.now() + 250;
    }
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    getWorld().endGrab();
    stage.controls.enabled = true;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => {
    getWorld().ornaments.pointer.r = 0;
  });

  stage.onFrame(() => {
    if (performance.now() > hoverUntil) getWorld().ornaments.pointer.r = 0;
  });

  canvas.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!touched) {
        touched = true;
        hooks.onFirstTouch?.();
      }
      getWorld().assist();
    }
  });
}

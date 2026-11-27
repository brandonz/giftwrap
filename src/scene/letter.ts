// The gift's card, sealed in its envelope, rising out of the opened box to face the camera. The page
// then puts its own card in the same place on screen and carries on from there (see openEnvelope).

import { Box2, CanvasTexture, Euler, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { BASE, FLOOR, TOP } from '../sim/dims';
import type { Stage } from './stage';

/** Largest size, in scene units: it starts lying flat on the box's floor, so it has to fit there. */
const MAX_W = 1.3;
const MAX_H = 1.7;
/**
 * Seconds: a beat after the lid pops, then the rise. It comes towards the camera from COME_AT, then
 * holds still before the swap.
 */
const DELAY = 0.15;
const RISE = 0.8;
const COME_AT = 0.5;
const COME = 0.6;
const HOLD = 0.08;
/** It rises to here, above the box... */
const HOVER = new Vector3(0, TOP + 0.8, 0);
/** ...then comes this share of the way to the camera: it stays on the same spot on screen and grows. */
const FORWARD = 0.3;
/** Just off the floor, so the two do not fight over depth. */
const START_Y = FLOOR + 0.01;
/** The top of the box's walls. */
const RIM = BASE.cy + BASE.hy;
const UP = new Vector3(0, 1, 0);
const CORNERS = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

export class Letter {
  private readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** When the rise began (frame time, seconds), or null when it is not rising. */
  private start: number | null = null;
  private arrive: ((box: DOMRect | null) => void) | null = null;
  private readonly flat = new Quaternion();
  private readonly sway = new Quaternion();
  private readonly toward = new Vector3();
  private readonly toCamera = new Vector3();
  private readonly back = new Vector3();
  private readonly side = new Vector3();
  private readonly m = new Matrix4();
  private readonly e = new Euler();
  private readonly v = new Vector3();
  private readonly p = new Vector2();
  private readonly box = new Box2();

  constructor(private readonly stage: Stage) {
    // Unlit and not tone mapped: it has to look just like the page's card that replaces it. A stand-in
    // picture until it rises, so its shader is compiled with the rest at load rather than mid-opening.
    const material = new MeshBasicMaterial({ map: new CanvasTexture(document.createElement('canvas')), transparent: true, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
    stage.onFrame((_, t) => this.update(t));
  }

  /**
   * Rises out of the box with `art` on its face. Settles with where it ended up on the page, once
   * it has arrived (and hidden itself), or when land() cuts it short; null if it was not on the page.
   */
  rise(art: HTMLCanvasElement, aspect: number): Promise<DOMRect | null> {
    const w = Math.min(MAX_W, MAX_H * aspect);
    this.mesh.scale.set(w, w / aspect, 1);
    const map = new CanvasTexture(art);
    map.colorSpace = SRGBColorSpace;
    // Seen at a slant while it lies in the box.
    map.anisotropy = 4;
    this.mesh.material.map?.dispose();
    this.mesh.material.map = map;
    this.inBox(true);
    this.pose(0);
    this.start = performance.now() / 1000;
    this.mesh.visible = true;
    return new Promise((resolve) => (this.arrive = resolve));
  }

  /** Stops it where it is and hides it; rise() settles with where it was on the page. */
  land() {
    const arrive = this.arrive;
    if (!arrive) return;
    this.arrive = null;
    this.start = null;
    this.mesh.visible = false;
    arrive(this.onPage());
    this.mesh.material.map?.dispose();
  }

  private update(t: number) {
    if (this.start === null) return;
    const time = t - this.start;
    // Still since the last frame or two, so the last one drawn shows it where onPage() measures it.
    if (time >= COME_AT + COME + HOLD) this.land();
    else this.pose(time);
  }

  private pose(time: number) {
    const cam = this.stage.camera;
    const target = this.stage.controls.target;
    const p = clamp01((time - DELAY) / RISE);
    this.toward.set(cam.position.x - target.x, 0, cam.position.z - target.z).normalize();
    // Lying face up, its top edge away from the camera; it turns to face the camera as it comes out.
    this.back.copy(this.toward).negate();
    this.side.crossVectors(this.back, UP);
    this.flat.setFromRotationMatrix(this.m.makeBasis(this.side, this.back, UP));
    const turn = easeInOut(clamp01((p - 0.1) / 0.7));
    // A little tilt on the way, gone by the time it arrives.
    const tilt = Math.sin(p * Math.PI * 3) * (1 - p) * 0.1;
    this.sway.setFromEuler(this.e.set(0, tilt * 0.6, tilt));
    this.mesh.quaternion.slerpQuaternions(this.flat, cam.quaternion, turn).multiply(this.sway);
    this.mesh.position.set(0, START_Y + (HOVER.y - START_Y) * backOut(p), 0);
    this.toCamera.subVectors(cam.position, HOVER);
    this.mesh.position.addScaledVector(this.toCamera, FORWARD * easeInOut(clamp01((time - COME_AT) / COME)));
    // Out for good once all of it is above the walls.
    if (this.mesh.material.depthTest && this.aboveRim()) this.inBox(false);
  }

  private aboveRim(): boolean {
    this.mesh.updateMatrixWorld();
    return CORNERS.every(([x, y]) => this.v.set(x, y, 0).applyMatrix4(this.mesh.matrixWorld).y > RIM);
  }

  /**
   * In the box, its walls hide it: that is what shows it coming out of the box. Once out, it is drawn
   * over everything, as the page's card that takes its place will be, so nothing jumps behind it at the
   * swap; nor does it cut through the tumbling lid on the way.
   */
  private inBox(inside: boolean) {
    this.mesh.material.depthTest = inside;
    // In the box: with the ground and its shadow, before the snow and sparks (see paintedShadow in stage.ts).
    this.mesh.renderOrder = inside ? -0.5 : 10;
  }

  /** Its bounding box on the page, or null with nothing to measure against (a hidden canvas). */
  private onPage(): DOMRect | null {
    const cam = this.stage.camera;
    this.mesh.updateMatrixWorld();
    cam.updateMatrixWorld();
    this.box.makeEmpty();
    for (const [x, y] of CORNERS) {
      this.v.set(x, y, 0).applyMatrix4(this.mesh.matrixWorld).project(cam);
      this.box.expandByPoint(this.p.set(this.v.x, this.v.y));
    }
    const r = this.stage.canvas.getBoundingClientRect();
    const { min, max } = this.box;
    const w = ((max.x - min.x) / 2) * r.width;
    const h = ((max.y - min.y) / 2) * r.height;
    if (!(w > 0 && h > 0)) return null;
    return new DOMRect(r.left + ((min.x + 1) / 2) * r.width, r.top + ((1 - max.y) / 2) * r.height, w, h);
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Ease-out that runs a few percent past the end and settles back. */
const backOut = (x: number, s = 0.9) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;

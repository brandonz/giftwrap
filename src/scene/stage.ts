// Renderer, camera, lights, ground and snow. Shared by both pages.

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Points,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type Tier = 'high' | 'low';

export function detectTier(): Tier {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  const cores = navigator.hardwareConcurrency || 4;
  return coarse || small || cores <= 4 ? 'low' : 'high';
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    // Give the probe context back at once: browsers cap live contexts per page.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

export interface StageOptions {
  tier: Tier;
  /** Radius around the gift the camera keeps in view. */
  fitRadius: number;
  autoRotate?: boolean;
}

type FrameFn = (dt: number, t: number) => void;

export interface ContextHooks {
  /** The GPU dropped the WebGL context (a GPU reset, or the browser reclaiming memory). The canvas shows nothing until it is restored. */
  lost?: () => void;
  /** The context is back and the scene renders again. */
  restored?: () => void;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(36, 1, 0.1, 60);
  readonly controls: OrbitControls;
  readonly key: DirectionalLight;
  readonly tier: Tier;
  private readonly frameFns: FrameFn[] = [];
  private readonly snow: Points;
  private snowBoost = 0;
  private readonly fitRadius: number;
  private last = 0;
  private slowFrames = 0;
  private dprCap: number;
  private readonly contextHooks: ContextHooks[] = [];
  /** Bumped by each restore, so a slower earlier warm-up does not restart the loop. */
  private epoch = 0;

  constructor(readonly canvas: HTMLCanvasElement, opts: StageOptions) {
    this.tier = opts.tier;
    this.fitRadius = opts.fitRadius;
    // Throws if the context cannot be created (for example, WebGL blocked for this site after a GPU reset).
    const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer = r;
    this.dprCap = opts.tier === 'high' ? 2 : 1.5;
    r.setPixelRatio(Math.min(devicePixelRatio, this.dprCap));
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;

    this.buildEnvironment();
    this.scene.environmentIntensity = 0.55;

    this.scene.add(new HemisphereLight(0xbcd2ff, 0x3a2414, 0.7));
    const key = new DirectionalLight(0xffe3bd, 2.4);
    key.position.set(4, 8.5, 3.5);
    key.castShadow = true;
    const sm = opts.tier === 'high' ? 2048 : 1024;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.camera.left = key.shadow.camera.bottom = -4.5;
    key.shadow.camera.right = key.shadow.camera.top = 4.5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.key = key;
    this.scene.add(key);
    const rim = new DirectionalLight(0x8fb4ff, 1.1);
    rim.position.set(-5, 3, -5);
    this.scene.add(rim);

    this.scene.add(ground());
    this.snow = snow(opts.tier === 'high' ? 900 : 420);
    this.scene.add(this.snow);

    this.camera.position.set(4.6, 3.6, 5.6);
    const c = new OrbitControls(this.camera, canvas);
    c.target.set(0, 0.85, 0);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enablePan = false;
    c.minPolarAngle = 0.25;
    c.maxPolarAngle = 1.38;
    c.rotateSpeed = 0.7;
    c.autoRotate = !!opts.autoRotate;
    c.autoRotateSpeed = 0.6;
    this.controls = c;

    // Mobile GPUs reset under load, and browsers drop contexts to reclaim memory. three.js calls
    // preventDefault() so the context can come back; the pages decide what to show meanwhile.
    canvas.addEventListener('webglcontextlost', () => {
      for (const h of this.contextHooks) h.lost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => void this.recover());

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  onContext(hooks: ContextHooks) {
    this.contextHooks.push(hooks);
  }

  private buildEnvironment() {
    this.scene.environment?.dispose();
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  onFrame(fn: FrameFn) {
    this.frameFns.push(fn);
  }

  /** More snow for a few seconds. */
  flurry(seconds: number) {
    this.snowBoost = seconds;
  }

  /**
   * Starts the render loop. Shaders are compiled first and off the first frame: on phones, compiling
   * every program and drawing in one GPU task is the heaviest moment of the page.
   */
  async start() {
    const epoch = this.epoch;
    await this.warmUp();
    if (epoch === this.epoch) this.loop();
  }

  /**
   * After a restore every program is recompiled and the environment re-rendered: the same peak as the
   * first load, so it gets the same treatment. The page keeps its fallback up until this is done.
   */
  private async recover() {
    const epoch = ++this.epoch;
    this.renderer.setAnimationLoop(null);
    // three.js re-uploads meshes and textures by itself, but render-target contents are gone.
    this.buildEnvironment();
    await this.warmUp();
    if (epoch !== this.epoch || this.renderer.getContext().isContextLost()) return;
    this.loop();
    for (const h of this.contextHooks) h.restored?.();
  }

  private async warmUp() {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      // The first frame compiles whatever is left.
    }
  }

  private loop() {
    this.renderer.setAnimationLoop((t) => this.frame(t / 1000));
  }

  private frame(t: number) {
    const dt = this.last ? Math.min(0.1, t - this.last) : 1 / 60;
    this.last = t;
    this.adapt(dt);
    for (const f of this.frameFns) f(dt, t);
    this.updateSnow(dt);
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Lowers the pixel ratio if frames keep running long. */
  private adapt(dt: number) {
    this.slowFrames = dt > 1 / 40 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.dprCap > 1) {
      this.dprCap = Math.max(1, this.dprCap - 0.5);
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.dprCap));
      this.resize();
      this.slowFrames = 0;
    }
  }

  private updateSnow(dt: number) {
    const pos = this.snow.geometry.getAttribute('position') as BufferAttribute;
    const a = pos.array as Float32Array;
    this.snowBoost = Math.max(0, this.snowBoost - dt);
    const speed = 0.35 + (this.snowBoost > 0 ? 1.4 : 0);
    const t = performance.now() / 1000;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] -= speed * dt * (0.6 + ((i * 13) % 7) * 0.08);
      a[i] += Math.sin(t * 0.7 + i) * 0.08 * dt;
      if (a[i + 1] < 0) a[i + 1] += 9;
    }
    pos.needsUpdate = true;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    // Keep the gift and its pit in view whatever the aspect ratio.
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    // Tall phones: frame a little tighter; the edge of the pit can go off screen.
    const radius = this.fitRadius * (cam.aspect < 0.8 ? 0.82 : 1);
    const dist = radius / Math.sin(Math.min(vfov, hfov) / 2);
    const dir = new Vector3().subVectors(cam.position, this.controls.target).normalize();
    cam.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.minDistance = dist * 0.55;
    this.controls.maxDistance = dist * 1.4;
    cam.updateProjectionMatrix();
  }
}

function ground(): Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.65, '#bbb');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const mat = new MeshStandardMaterial({ color: new Color('#22385c'), roughness: 0.95, metalness: 0, transparent: true, alphaMap: new CanvasTexture(c) });
  const m = new Mesh(new CircleGeometry(7, 64), mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function snow(count: number): Points {
  const a = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * 8;
    const t = Math.random() * Math.PI * 2;
    a[3 * i] = Math.cos(t) * r;
    a[3 * i + 1] = Math.random() * 9;
    a[3 * i + 2] = Math.sin(t) * r;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(a, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const mat = new PointsMaterial({ size: 0.07, map: new CanvasTexture(c), transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.85 });
  return new Points(geo, mat);
}

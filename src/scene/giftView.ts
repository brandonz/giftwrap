// Meshes for the box, lid, paper, ribbon and ornaments, kept in step with the simulation.

import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from 'three';
import type { PaperStyle, RibbonStyle, Rgb } from '../codec/gift';
import { BASE, LID } from '../sim/dims';
import type { World } from '../sim/world';
import { drawPattern, TILE_SIZES } from './patterns';

const ORNAMENT_COLORS = ['#b3122a', '#e3b341', '#1d6b4b', '#d9dee8', '#23457d', '#f4eee2', '#8e1c3a'];

const rgbColor = (c: Rgb) => new Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, SRGBColorSpace);

export class GiftView {
  readonly base: Mesh;
  readonly lid: Mesh;
  readonly paperFront: Mesh;
  readonly paperBack: Mesh;
  ribbon!: Mesh;
  readonly knot: Mesh;
  readonly ornaments: InstancedMesh;
  readonly glow: PointLight;
  private readonly glowMat: MeshStandardMaterial;
  private readonly paperGeo: BufferGeometry;
  private ribbonGeo!: BufferGeometry;
  // Physical (clearcoat, sheen) on the high tier; standard on phones, whose GPUs pay for every extra lobe.
  private readonly paperMat: MeshStandardMaterial;
  private readonly ribbonMat: MeshStandardMaterial;
  private readonly patternCanvas = document.createElement('canvas');
  private readonly patternTex: CanvasTexture;
  private paperStyle: PaperStyle | null = null;
  private knotScale = 1;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();

  constructor(
    private readonly scene: Scene,
    private world: World,
    tier: 'high' | 'low',
  ) {
    const card = new MeshStandardMaterial({ color: '#f1e6d2', roughness: 0.75 });
    this.glowMat = new MeshStandardMaterial({ color: '#2a1c10', emissive: new Color('#ffcf73'), emissiveIntensity: 0, roughness: 1 });
    // BoxGeometry material order: +x, -x, +y (open top, glowing), -y, +z, -z.
    this.base = new Mesh(new BoxGeometry(2 * BASE.hx, 2 * BASE.hy, 2 * BASE.hz), [card, card, this.glowMat, card, card, card]);
    this.base.position.set(BASE.cx, BASE.cy, BASE.cz);
    this.base.castShadow = this.base.receiveShadow = true;
    this.lid = new Mesh(new BoxGeometry(2 * LID.hx, 2 * LID.hy, 2 * LID.hz), card);
    this.lid.castShadow = this.lid.receiveShadow = true;
    this.glow = new PointLight('#ffc768', 0, 6, 1.5);
    this.glow.position.set(0, 1.6, 0);

    this.patternTex = new CanvasTexture(this.patternCanvas);
    this.patternTex.colorSpace = SRGBColorSpace;
    this.patternTex.wrapS = this.patternTex.wrapT = RepeatWrapping;
    this.patternTex.anisotropy = 8;
    const physical = tier === 'high';
    this.paperMat = physical
      ? new MeshPhysicalMaterial({ map: this.patternTex, side: FrontSide, roughness: 0.8 })
      : new MeshStandardMaterial({ map: this.patternTex, side: FrontSide, roughness: 0.8 });
    const backMat = new MeshStandardMaterial({ color: '#f5efe4', roughness: 0.92, side: BackSide });

    const paper = world.paper;
    this.paperGeo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(paper.cloth.n * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    this.paperGeo.setAttribute('position', pos);
    this.paperGeo.setAttribute('uv', new BufferAttribute(paper.uv.slice(), 2));
    this.paperGeo.setIndex(new BufferAttribute(paper.index, 1));
    this.paperFront = new Mesh(this.paperGeo, this.paperMat);
    this.paperBack = new Mesh(this.paperGeo, backMat);
    this.paperFront.castShadow = true;
    this.paperFront.receiveShadow = true;
    this.paperBack.receiveShadow = true;

    this.ribbonMat = physical
      ? new MeshPhysicalMaterial({ side: DoubleSide, roughness: 0.4, sheen: 1, sheenRoughness: 0.35 })
      : new MeshStandardMaterial({ side: DoubleSide, roughness: 0.4 });
    this.knot = new Mesh(new SphereGeometry(0.1, 20, 14), this.ribbonMat);
    this.knot.scale.set(1.1, 0.6, 1.1);
    this.knot.castShadow = true;

    const ornGeo = tier === 'high' ? new SphereGeometry(1, 28, 20) : new SphereGeometry(1, 18, 12);
    const ornMat = physical
      ? new MeshPhysicalMaterial({ roughness: 0.12, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 })
      : new MeshStandardMaterial({ roughness: 0.12, metalness: 0.35 });
    const o = world.ornaments;
    this.ornaments = new InstancedMesh(ornGeo, ornMat, o.count);
    this.ornaments.castShadow = true;
    this.ornaments.receiveShadow = true;
    for (let i = 0; i < o.count; i++) this.ornaments.setColorAt(i, new Color(ORNAMENT_COLORS[(i * 5 + 3) % ORNAMENT_COLORS.length]));

    scene.add(this.base, this.lid, this.paperFront, this.paperBack, this.knot, this.ornaments, this.glow);
    this.buildRibbonMesh();
  }

  /** Rebuilds the ribbon mesh after the world's ribbon changed shape. */
  buildRibbonMesh() {
    if (this.ribbon) {
      this.scene.remove(this.ribbon);
      this.ribbonGeo.dispose();
    }
    const r = this.world.ribbon;
    this.ribbonGeo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(r.cloth.n * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    this.ribbonGeo.setAttribute('position', pos);
    this.ribbonGeo.setAttribute('uv', new BufferAttribute(r.uv.slice(), 2));
    this.ribbonGeo.setIndex(new BufferAttribute(r.index, 1));
    this.ribbon = new Mesh(this.ribbonGeo, this.ribbonMat);
    this.ribbon.castShadow = true;
    this.ribbon.receiveShadow = true;
    this.scene.add(this.ribbon);
    this.knot.position.set(r.knot[0], r.knot[1] - 0.01, r.knot[2]);
    this.sync(0);
  }

  setPaper(p: PaperStyle) {
    const prev = this.paperStyle;
    const redraw = !prev || prev.pattern !== p.pattern || prev.base.join() !== p.base.join() || prev.accent.join() !== p.accent.join();
    if (redraw) {
      drawPattern(this.patternCanvas, p.pattern, p.base, p.accent);
      this.patternTex.needsUpdate = true;
    }
    const tile = TILE_SIZES[p.scale] ?? TILE_SIZES[1];
    this.patternTex.repeat.set(1 / tile, 1 / tile);
    const m = this.paperMat;
    // matte, gloss, foil
    m.roughness = [0.85, 0.32, 0.28][p.finish] ?? 0.85;
    m.metalness = [0, 0, 0.85][p.finish] ?? 0;
    if (m instanceof MeshPhysicalMaterial) {
      m.clearcoat = [0, 1, 0.4][p.finish] ?? 0;
      m.clearcoatRoughness = 0.12;
    }
    m.needsUpdate = true;
    this.paperStyle = { ...p };
  }

  setRibbon(r: RibbonStyle) {
    const m = this.ribbonMat;
    const c = rgbColor(r.color);
    m.color.copy(c);
    // satin, velvet, metallic
    m.roughness = [0.38, 0.85, 0.25][r.finish] ?? 0.38;
    m.metalness = [0, 0, 0.9][r.finish] ?? 0;
    if (m instanceof MeshPhysicalMaterial) {
      m.sheen = [1, 1, 0][r.finish] ?? 1;
      m.sheenColor.copy(c).lerp(new Color('#ffffff'), r.finish === 1 ? 0.15 : 0.5);
      m.sheenRoughness = r.finish === 1 ? 0.8 : 0.3;
    }
    m.needsUpdate = true;
  }

  setWorld(world: World) {
    this.world = world;
  }

  /** Copies simulation state into the meshes. */
  sync(dt: number) {
    const w = this.world;
    copy(this.paperGeo, w.paper.cloth.x);
    copy(this.ribbonGeo, w.ribbon.cloth.x);

    const target = w.phase === 'tied' ? 1 : 0;
    this.knotScale += (target - this.knotScale) * Math.min(1, dt * 10);
    this.knot.visible = this.knotScale > 0.02;
    this.knot.scale.set(1.1 * this.knotScale, 0.6 * this.knotScale, 1.1 * this.knotScale);

    const L = w.lid;
    this.lid.position.set(L.pos[0], L.pos[1], L.pos[2]);
    this.lid.quaternion.set(L.rot[0], L.rot[1], L.rot[2], L.rot[3]);

    const o = w.ornaments;
    for (let i = 0; i < o.count; i++) {
      this.v.set(o.pos[3 * i], o.pos[3 * i + 1], o.pos[3 * i + 2]);
      const r = o.radius[i];
      this.s.set(r, r, r);
      this.m.compose(this.v, this.q, this.s);
      this.ornaments.setMatrixAt(i, this.m);
    }
    this.ornaments.instanceMatrix.needsUpdate = true;

    if (w.phase === 'open') {
      this.glowMat.emissiveIntensity = Math.min(2.2, this.glowMat.emissiveIntensity + dt * 1.5);
      this.glow.intensity = Math.min(9, this.glow.intensity + dt * 8);
    }
  }

  /** Bounding volumes go stale as things move; refresh before raycasting. */
  refreshBounds() {
    this.paperGeo.computeBoundingSphere();
    this.ribbonGeo.computeBoundingSphere();
    this.ornaments.computeBoundingSphere();
  }
}

function copy(geo: BufferGeometry, x: Float64Array) {
  const pos = geo.getAttribute('position') as BufferAttribute;
  (pos.array as Float32Array).set(x);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

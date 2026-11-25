// Confetti, sparkles and a star. 'big' when the gift opens, 'small' when one is created.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { Stage } from './stage';

const CONFETTI_COLORS = ['#f2c14e', '#ffe7a3', '#c8102e', '#1f7a53', '#f7f3ea', '#e0a526'];

export class Celebration {
  private readonly confetti: InstancedMesh;
  private readonly cPos: Float32Array;
  private readonly cVel: Float32Array;
  private readonly cRot: Float32Array;
  private readonly cSpin: Float32Array;
  private readonly cLife: Float32Array;
  private readonly sparks: Points;
  private readonly sVel: Float32Array;
  private readonly sLife: Float32Array;
  private readonly star: Sprite;
  private starT = -1;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  constructor(
    private readonly stage: Stage,
    private readonly reducedMotion: boolean,
  ) {
    const n = stage.tier === 'high' ? 280 : 150;
    const mat = new MeshStandardMaterial({ side: DoubleSide, metalness: 0.45, roughness: 0.35 });
    this.confetti = new InstancedMesh(new PlaneGeometry(0.06, 0.1), mat, n);
    this.confetti.frustumCulled = false;
    this.confetti.count = 0;
    for (let i = 0; i < n; i++) this.confetti.setColorAt(i, new Color(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
    this.cPos = new Float32Array(n * 3);
    this.cVel = new Float32Array(n * 3);
    this.cRot = new Float32Array(n * 3);
    this.cSpin = new Float32Array(n * 3);
    this.cLife = new Float32Array(n);
    stage.scene.add(this.confetti);

    const sn = 160;
    const geo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(sn * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pos);
    this.sparks = new Points(
      geo,
      new PointsMaterial({ size: 0.12, map: glowTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, color: '#ffe3a0' }),
    );
    this.sparks.frustumCulled = false;
    this.sVel = new Float32Array(sn * 3);
    this.sLife = new Float32Array(sn);
    stage.scene.add(this.sparks);

    this.star = new Sprite(new SpriteMaterial({ map: starTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 }));
    this.star.visible = false;
    stage.scene.add(this.star);

    stage.onFrame((dt, t) => this.update(dt, t));
  }

  play(kind: 'big' | 'small', origin: [number, number, number]) {
    if (kind === 'big') {
      this.starT = 0;
      this.star.visible = true;
      this.star.position.set(origin[0], origin[1] + 1.5, origin[2]);
      if (this.reducedMotion) return;
      this.stage.flurry(4);
      this.launchConfetti(this.cLife.length, origin, 5.5);
      this.launchSparks(160, origin, 3.2);
    } else {
      if (this.reducedMotion) return;
      this.launchConfetti(Math.min(70, this.cLife.length), origin, 3.6);
      this.launchSparks(90, origin, 2);
    }
  }

  private launchConfetti(count: number, o: number[], power: number) {
    const n = this.cLife.length;
    this.confetti.count = n;
    let launched = 0;
    for (let i = 0; i < n && launched < count; i++) {
      if (this.cLife[i] > 0 && count < n) continue;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.7) * power * 0.35;
      this.cPos.set([o[0] + (Math.random() - 0.5) * 0.6, o[1], o[2] + (Math.random() - 0.5) * 0.6], 3 * i);
      this.cVel.set([Math.cos(a) * sp, power * (0.7 + Math.random() * 0.5), Math.sin(a) * sp], 3 * i);
      this.cRot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], 3 * i);
      this.cSpin.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], 3 * i);
      this.cLife[i] = 7 + Math.random() * 2;
      launched++;
    }
  }

  private launchSparks(count: number, o: number[], power: number) {
    const pos = this.sparks.geometry.getAttribute('position') as BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < Math.min(count, this.sLife.length); i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      const sp = power * (0.4 + Math.random() * 0.6);
      a.set([o[0], o[1] + 0.2, o[2]], 3 * i);
      this.sVel.set([Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp + 1, Math.sin(ph) * Math.sin(th) * sp], 3 * i);
      this.sLife[i] = 0.8 + Math.random() * 0.9;
    }
    pos.needsUpdate = true;
  }

  private update(dt: number, t: number) {
    // Confetti: tumbling paper, falling slowly, resting where it lands.
    let alive = 0;
    for (let i = 0; i < this.cLife.length; i++) {
      if (this.cLife[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.confetti.setMatrixAt(i, this.m);
        continue;
      }
      alive++;
      this.cLife[i] -= dt;
      const k = 3 * i;
      const onGround = this.cPos[k + 1] <= 0.012;
      if (!onGround) {
        this.cVel[k + 1] -= 4.2 * dt;
        for (let c = 0; c < 3; c++) this.cVel[k + c] *= 1 - 1.6 * dt;
        this.cVel[k] += Math.sin(t * 3 + i) * 0.6 * dt;
        for (let c = 0; c < 3; c++) {
          this.cPos[k + c] += this.cVel[k + c] * dt;
          this.cRot[k + c] += this.cSpin[k + c] * dt;
        }
        if (this.cPos[k + 1] < 0.012) {
          this.cPos[k + 1] = 0.012;
          this.cRot[k] = -Math.PI / 2;
          this.cRot[k + 2] = 0;
        }
      }
      const fade = Math.min(1, this.cLife[i] / 1.2);
      this.p.set(this.cPos[k], this.cPos[k + 1], this.cPos[k + 2]);
      this.q.setFromEuler(this.e.set(this.cRot[k], this.cRot[k + 1], this.cRot[k + 2]));
      this.s.copy(this.one).multiplyScalar(fade);
      this.m.compose(this.p, this.q, this.s);
      this.confetti.setMatrixAt(i, this.m);
    }
    this.confetti.instanceMatrix.needsUpdate = true;
    if (!alive) this.confetti.count = 0;

    const pos = this.sparks.geometry.getAttribute('position') as BufferAttribute;
    const a = pos.array as Float32Array;
    let sparkling = false;
    for (let i = 0; i < this.sLife.length; i++) {
      if (this.sLife[i] <= 0) {
        a[3 * i + 1] = -10;
        continue;
      }
      sparkling = true;
      this.sLife[i] -= dt;
      this.sVel[3 * i + 1] -= 2.5 * dt;
      for (let c = 0; c < 3; c++) {
        this.sVel[3 * i + c] *= 1 - 1.8 * dt;
        a[3 * i + c] += this.sVel[3 * i + c] * dt;
      }
    }
    if (sparkling) pos.needsUpdate = true;
    (this.sparks.material as PointsMaterial).opacity = 0.6 + Math.sin(t * 30) * 0.4;

    if (this.starT >= 0) {
      this.starT += dt;
      const st = this.starT;
      const grow = Math.min(1, st / 0.6);
      const pulse = 1 + Math.sin(st * 2.2) * 0.06;
      const flare = st < 0.6 ? 1.6 * grow : 1.15 + 0.45 * Math.exp(-(st - 0.6) * 3);
      this.star.scale.setScalar(flare * pulse);
      (this.star.material as SpriteMaterial).opacity = Math.min(1, st * 2);
      (this.star.material as SpriteMaterial).rotation = st * 0.25;
    }
  }
}

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,230,160,0.8)');
  grad.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

function starTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  const S = 256;
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const halo = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  halo.addColorStop(0, 'rgba(255,240,200,0.9)');
  halo.addColorStop(0.2, 'rgba(255,210,120,0.35)');
  halo.addColorStop(1, 'rgba(255,190,80,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  // Four long rays and four short ones.
  g.translate(S / 2, S / 2);
  for (let i = 0; i < 8; i++) {
    const len = i % 2 ? S * 0.22 : S * 0.48;
    const w = i % 2 ? 5 : 9;
    const grad = g.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, 'rgba(255,250,230,1)');
    grad.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-w, 0);
    g.lineTo(0, -len);
    g.lineTo(w, 0);
    g.closePath();
    g.fill();
    g.rotate(Math.PI / 4);
  }
  return new CanvasTexture(c);
}

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
  type Blending,
  type Scene,
} from 'three';

/**
 * Particle system: fixed-size GPU pools (one draw call per blend mode), CPU-simulated. Nothing is
 * allocated while emitting, so heavy fire or chained explosions cost no GC or shader compiles.
 *
 * Effects are presets built from `emit()` calls: see `ParticleFX` below.
 */
export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Random velocity added on each axis (± spread). */
  spread?: number;
  life: number;
  /** Size in world metres at birth → death. */
  size: number;
  sizeEnd?: number;
  /** RGB 0…1 at birth → death. */
  color: [number, number, number];
  colorEnd?: [number, number, number];
  alpha?: number;
  gravity?: number;
  drag?: number;
  count?: number;
}

const VERT = `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float soft = 1.0 - r;
  gl_FragColor = vec4(vColor.rgb, vColor.a * soft * soft);
}`;

class Pool {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  /** size0, size1, gravity, drag */
  private readonly params: Float32Array;
  /** r0 g0 b0 r1 g1 b1 alpha */
  private readonly colors: Float32Array;
  private next = 0;
  private alive = 0;
  readonly material: ShaderMaterial;

  constructor(
    private readonly capacity: number,
    blending: Blending,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.params = new Float32Array(capacity * 4);
    this.colors = new Float32Array(capacity * 7);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(o: EmitOptions): void {
    const n = o.count ?? 1;
    const sp = o.spread ?? 0;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      if (this.life[i]! <= 0) this.alive++;
      this.pos[i * 3] = o.x;
      this.pos[i * 3 + 1] = o.y;
      this.pos[i * 3 + 2] = o.z;
      this.vel[i * 3] = (o.vx ?? 0) + (Math.random() * 2 - 1) * sp;
      this.vel[i * 3 + 1] = (o.vy ?? 0) + (Math.random() * 2 - 1) * sp;
      this.vel[i * 3 + 2] = (o.vz ?? 0) + (Math.random() * 2 - 1) * sp;
      const life = o.life * (0.75 + Math.random() * 0.5);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.params.set([o.size, o.sizeEnd ?? o.size, o.gravity ?? 0, o.drag ?? 0], i * 4);
      const c1 = o.colorEnd ?? o.color;
      this.colors.set([o.color[0], o.color[1], o.color[2], c1[0], c1[1], c1[2], o.alpha ?? 1], i * 7);
    }
  }

  update(dt: number): void {
    if (this.alive <= 0) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      let l = this.life[i]!;
      if (l <= 0) {
        this.size[i] = 0;
        continue;
      }
      l -= dt;
      this.life[i] = l;
      if (l <= 0) {
        this.size[i] = 0;
        continue;
      }
      alive++;
      const p = i * 4;
      const drag = Math.exp(-this.params[p + 3]! * dt);
      const v = i * 3;
      this.vel[v]! *= drag;
      this.vel[v + 1] = this.vel[v + 1]! * drag - this.params[p + 2]! * dt;
      this.vel[v + 2]! *= drag;
      this.pos[v] = this.pos[v]! + this.vel[v]! * dt;
      this.pos[v + 1] = this.pos[v + 1]! + this.vel[v + 1]! * dt;
      this.pos[v + 2] = this.pos[v + 2]! + this.vel[v + 2]! * dt;
      const k = 1 - l / this.maxLife[i]!;
      this.size[i] = this.params[p]! + (this.params[p + 1]! - this.params[p]!) * k;
      const c = i * 7;
      this.col[i * 4] = this.colors[c]! + (this.colors[c + 3]! - this.colors[c]!) * k;
      this.col[i * 4 + 1] = this.colors[c + 1]! + (this.colors[c + 4]! - this.colors[c + 1]!) * k;
      this.col[i * 4 + 2] = this.colors[c + 2]! + (this.colors[c + 5]! - this.colors[c + 2]!) * k;
      // Quick fade-in, long fade-out.
      this.col[i * 4 + 3] = this.colors[c + 6]! * Math.min(1, k * 12) * (1 - k);
    }
    this.alive = alive;
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.aColor!.needsUpdate = true;
    g.attributes.aSize!.needsUpdate = true;
  }
}

export class ParticleSystem {
  private disposed = false;
  /** Fire, sparks, glow. */
  readonly glow = new Pool(1536, AdditiveBlending);
  /** Smoke, dust, debris. */
  readonly smoke = new Pool(1024, NormalBlending);

  constructor(private readonly scene: Scene) {
    scene.add(this.glow.points, this.smoke.points);
  }

  /** Keeps point sizes in world units for the current viewport height / fov. */
  setViewport(heightPx: number, fovDeg: number): void {
    const scale = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.material.uniforms.uScale!.value = scale;
    this.smoke.material.uniforms.uScale!.value = scale;
  }

  update(dt: number): void {
    this.glow.update(dt);
    this.smoke.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.glow.points, this.smoke.points);
    for (const pool of [this.glow, this.smoke]) {
      pool.points.geometry.dispose();
      pool.material.dispose();
    }
  }
}

const tmp = new Vector3();

/** The effect presets. */
export const ParticleFX = {
  /** Flamethrower: a roaring tongue of fire along the aim, embers, and dark smoke above it. */
  flame(ps: ParticleSystem, x: number, y: number, z: number, dx: number, dz: number, range: number): void {
    const speed = range * 2.2;
    for (let i = 0; i < 7; i++) {
      const a = (Math.random() - 0.5) * 0.45;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const fx = dx * c - dz * s;
      const fz = dx * s + dz * c;
      const v = speed * (0.75 + Math.random() * 0.4);
      ps.glow.emit({ x, y, z, vx: fx * v, vy: 0.6 + Math.random(), vz: fz * v, life: 0.42, size: 0.25, sizeEnd: 1.5, color: [1, 0.85, 0.4], colorEnd: [0.85, 0.18, 0.02], drag: 2.2, alpha: 0.9 });
    }
    ps.glow.emit({ x, y, z, life: 0.06, size: 0.35, color: [1, 0.95, 0.75] });
    if (Math.random() < 0.6) ps.glow.emit({ x, y, z, vx: dx * speed * 0.7, vy: 2, vz: dz * speed * 0.7, spread: 2, life: 0.8, size: 0.05, color: [1, 0.7, 0.2], colorEnd: [1, 0.25, 0], gravity: 6 });
    const d = range * 0.7;
    ps.smoke.emit({ x: x + dx * d, y: y + 0.6, z: z + dz * d, vx: dx * 1.5, vy: 1.6, vz: dz * 1.5, spread: 0.6, life: 1.6, size: 0.5, sizeEnd: 2.2, color: [0.18, 0.15, 0.13], colorEnd: [0.35, 0.33, 0.31], alpha: 0.45, drag: 1.2 });
  },

  /** Something on fire: licking flames and a smoke plume rising off it. */
  burning(ps: ParticleSystem, x: number, y: number, z: number): void {
    ps.glow.emit({ x: x + (Math.random() - 0.5) * 0.5, y: y + Math.random() * 1.5, z: z + (Math.random() - 0.5) * 0.5, vy: 1.8, spread: 0.3, life: 0.45, size: 0.35, sizeEnd: 0.05, color: [1, 0.75, 0.25], colorEnd: [0.9, 0.2, 0.02], alpha: 0.85 });
    if (Math.random() < 0.35) ps.smoke.emit({ x, y: y + 1.6, z, vy: 1.4, spread: 0.3, life: 1.8, size: 0.3, sizeEnd: 1.4, color: [0.15, 0.13, 0.12], colorEnd: [0.4, 0.38, 0.36], alpha: 0.4, drag: 0.8 });
  },

  /** Campfire: low licking flames, rising embers and a thin smoke column. */
  campfire(ps: ParticleSystem, x: number, y: number, z: number): void {
    for (let i = 0; i < 2; i++) {
      ps.glow.emit({ x: x + (Math.random() - 0.5) * 0.45, y: y + 0.1 + Math.random() * 0.15, z: z + (Math.random() - 0.5) * 0.45, vy: 1.1 + Math.random() * 0.6, spread: 0.12, life: 0.55, size: 0.32, sizeEnd: 0.04, color: [1, 0.78, 0.3], colorEnd: [0.95, 0.22, 0.02], alpha: 0.9 });
    }
    if (Math.random() < 0.25) ps.glow.emit({ x, y: y + 0.3, z, vy: 1.8, spread: 0.5, life: 1.4, size: 0.04, sizeEnd: 0.01, color: [1, 0.7, 0.25], colorEnd: [1, 0.3, 0], alpha: 1 });
    if (Math.random() < 0.18) ps.smoke.emit({ x, y: y + 0.9, z, vy: 0.9, spread: 0.15, life: 2.6, size: 0.2, sizeEnd: 1.1, color: [0.2, 0.18, 0.17], colorEnd: [0.45, 0.43, 0.41], alpha: 0.3, drag: 0.6 });
  },

  /** Rocket exhaust: flame at the nozzle and a thick lingering smoke trail. */
  rocketTrail(ps: ParticleSystem, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    ps.glow.emit({ x, y, z, vx: -dx * 4, vy: -dy * 4, vz: -dz * 4, spread: 0.6, life: 0.12, size: 0.45, sizeEnd: 0.1, color: [1, 0.9, 0.55], colorEnd: [1, 0.35, 0.05] });
    ps.smoke.emit({ x, y, z, vx: -dx, vy: 0.3, vz: -dz, spread: 0.25, life: 2.2, size: 0.3, sizeEnd: 1.3, color: [0.82, 0.8, 0.77], colorEnd: [0.6, 0.58, 0.56], alpha: 0.55, drag: 1.5 });
  },

  /** Thin smoke wisp behind a 40 mm grenade. */
  smokeTrail(ps: ParticleSystem, x: number, y: number, z: number): void {
    ps.smoke.emit({ x, y, z, vy: 0.2, spread: 0.08, life: 0.8, size: 0.08, sizeEnd: 0.35, color: [0.75, 0.74, 0.72], alpha: 0.4, drag: 1 });
  },

  /** Faint air streak behind a flying bolt. */
  boltTrail(ps: ParticleSystem, x: number, y: number, z: number): void {
    ps.glow.emit({ x, y, z, life: 0.12, size: 0.05, sizeEnd: 0.01, color: [0.85, 0.85, 0.8], alpha: 0.5 });
  },

  /** Gunfire: a white-hot core and flame tongue at the muzzle, sparks and a puff of smoke. */
  muzzleFlash(ps: ParticleSystem, x: number, y: number, z: number, dx: number, dy: number, dz: number, heavy: boolean): void {
    const s = heavy ? 1.4 : 1;
    ps.glow.emit({ x, y, z, life: 0.05, size: 0.55 * s, sizeEnd: 0.2, color: [1, 0.95, 0.8], colorEnd: [1, 0.6, 0.2] });
    for (let i = 1; i <= 4; i++) {
      const d = i * 0.09 * s;
      ps.glow.emit({ x: x + dx * d, y: y + dy * d, z: z + dz * d, vx: dx * 3, vy: dy * 3, vz: dz * 3, life: 0.06, size: (0.42 - i * 0.07) * s, sizeEnd: 0.05, color: [1, 0.78, 0.35], colorEnd: [0.9, 0.3, 0.05] });
    }
    ps.glow.emit({ x, y, z, vx: dx * 9, vy: dy * 9 + 1, vz: dz * 9, spread: 4, life: 0.18, size: 0.05, sizeEnd: 0.01, color: [1, 0.85, 0.4], colorEnd: [1, 0.3, 0], gravity: 9, count: heavy ? 8 : 4 });
    ps.smoke.emit({ x, y, z, vx: dx * 1.5, vy: dy * 1.5 + 0.5, vz: dz * 1.5, spread: 0.35, life: 0.9, size: 0.18 * s, sizeEnd: 0.9 * s, color: [0.75, 0.72, 0.68], alpha: 0.45, drag: 2.5, count: heavy ? 4 : 2 });
  },

  /** Barrel heat: a lingering orange glow at the muzzle that builds up under sustained fire. */
  barrelGlow(ps: ParticleSystem, x: number, y: number, z: number, heat: number): void {
    if (heat <= 0.05) return;
    ps.glow.emit({ x, y, z, life: 0.12, size: 0.12 + 0.18 * heat, sizeEnd: 0.08, color: [1, 0.45 * heat + 0.15, 0.08], alpha: 0.35 + 0.5 * heat });
    if (heat > 0.5 && Math.random() < heat * 0.3) ps.smoke.emit({ x, y, z, vy: 0.6, spread: 0.08, life: 1.2, size: 0.06, sizeEnd: 0.35, color: [0.7, 0.7, 0.7], alpha: 0.25, drag: 1 });
  },

  /** Bullets leaving the gun: spent casing kicked out of the ejection port, impact sparks + dust. */
  shellEject(ps: ParticleSystem, x: number, y: number, z: number, rx: number, rz: number): void {
    ps.glow.emit({ x, y, z, vx: rx * 2.6, vy: 2.4, vz: rz * 2.6, spread: 0.5, life: 0.55, size: 0.045, color: [1, 0.78, 0.32], colorEnd: [0.7, 0.45, 0.15], gravity: 14, alpha: 0.9 });
  },

  impact(ps: ParticleSystem, x: number, y: number, z: number): void {
    ps.glow.emit({ x, y, z, spread: 3, vy: 1.5, life: 0.18, size: 0.05, sizeEnd: 0.01, color: [1, 0.9, 0.55], colorEnd: [1, 0.4, 0.1], gravity: 10, count: 4 });
    ps.smoke.emit({ x, y, z, vy: 0.8, spread: 0.6, life: 0.6, size: 0.15, sizeEnd: 0.7, color: [0.62, 0.56, 0.46], alpha: 0.6, drag: 3, count: 2 });
  },

  /** Blood: a spray of droplets out of the wound along the shot, plus a fine red mist. */
  blood(ps: ParticleSystem, x: number, y: number, z: number, dx: number, dz: number, amount = 1): void {
    const n = Math.round(8 * amount);
    ps.smoke.emit({ x, y, z, vx: dx * 3.5, vy: 1.6, vz: dz * 3.5, spread: 2.2, life: 0.6, size: 0.07, sizeEnd: 0.05, color: [0.55, 0.02, 0.02], colorEnd: [0.3, 0.0, 0.0], gravity: 14, alpha: 1, count: n });
    ps.smoke.emit({ x, y, z, vx: dx * 1.2, vy: 0.3, vz: dz * 1.2, spread: 0.5, life: 0.5, size: 0.2, sizeEnd: 0.65 * amount, color: [0.6, 0.05, 0.04], alpha: 0.55, drag: 4, count: 2 });
  },

  /** Gore: chunks of flesh and bone flung out (headshots, severed limbs, blasts). */
  gore(ps: ParticleSystem, x: number, y: number, z: number, dx: number, dz: number, amount = 1): void {
    const n = Math.round(10 * amount);
    for (let i = 0; i < n; i++) {
      const bone = Math.random() < 0.2;
      const v = 2 + Math.random() * 4;
      ps.smoke.emit({
        x,
        y,
        z,
        vx: dx * v + (Math.random() - 0.5) * 3,
        vy: 1.5 + Math.random() * 3.5,
        vz: dz * v + (Math.random() - 0.5) * 3,
        life: 1.1,
        size: bone ? 0.08 : 0.11 + Math.random() * 0.08,
        color: bone ? [0.85, 0.8, 0.68] : [0.45 + Math.random() * 0.2, 0.06, 0.07],
        colorEnd: bone ? [0.7, 0.65, 0.55] : [0.28, 0.02, 0.03],
        gravity: 16,
        alpha: 1,
      });
    }
    ParticleFX.blood(ps, x, y, z, dx, dz, amount * 1.6);
  },

  /** Explosion: flash, fireball, flying sparks and debris, then a rising, spreading smoke column. */
  explosion(ps: ParticleSystem, x: number, y: number, z: number, radius: number): void {
    ps.glow.emit({ x, y: y + 0.5, z, life: 0.12, size: radius * 1.4, sizeEnd: radius * 1.8, color: [1, 0.95, 0.8], alpha: 0.9 });
    for (let i = 0; i < 40; i++) {
      tmp.set(Math.random() * 2 - 1, Math.random() * 0.9 + 0.1, Math.random() * 2 - 1).normalize();
      const v = 4 + Math.random() * 6;
      ps.glow.emit({ x, y: y + 0.4, z, vx: tmp.x * v, vy: tmp.y * v, vz: tmp.z * v, life: 0.5, size: 1.6, sizeEnd: 0.3, color: [1, 0.75, 0.3], colorEnd: [0.8, 0.15, 0.02], drag: 4.5 });
    }
    for (let i = 0; i < 60; i++) {
      tmp.set(Math.random() * 2 - 1, Math.random() * 1.2 + 0.2, Math.random() * 2 - 1).normalize();
      const v = 10 + Math.random() * 14;
      ps.glow.emit({ x, y: y + 0.3, z, vx: tmp.x * v, vy: tmp.y * v, vz: tmp.z * v, life: 0.7, size: 0.08, sizeEnd: 0.02, color: [1, 0.9, 0.5], colorEnd: [1, 0.35, 0.05], gravity: 18, drag: 1.2 });
    }
    for (let i = 0; i < 26; i++) {
      tmp.set(Math.random() * 2 - 1, Math.random() * 1.5 + 0.5, Math.random() * 2 - 1).normalize();
      const v = 5 + Math.random() * 7;
      ps.smoke.emit({ x, y: y + 0.2, z, vx: tmp.x * v, vy: tmp.y * v, vz: tmp.z * v, life: 1.1, size: 0.12, color: [0.32, 0.27, 0.2], gravity: 16, alpha: 0.95 });
    }
    for (let i = 0; i < 30; i++) {
      tmp.set(Math.random() * 2 - 1, Math.random() * 0.6, Math.random() * 2 - 1);
      ps.smoke.emit({ x: x + tmp.x * radius * 0.25, y: y + 0.5 + tmp.y, z: z + tmp.z * radius * 0.25, vx: tmp.x * 2.5, vy: 1.4 + Math.random() * 1.6, vz: tmp.z * 2.5, life: 3.2, size: 1.2, sizeEnd: radius * 0.9, color: [0.32, 0.29, 0.26], colorEnd: [0.55, 0.53, 0.5], alpha: 0.7, drag: 1.4 });
    }
  },
};

import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, type Scene } from 'three';

const MAX = 700;

interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; grow: number; alpha: number; spin: number; angle: number; shade: number }

/**
 * World-space damage smoke. Puffs are emitted at the engine bay, inherit part of the vehicle's
 * velocity and are then held back by air drag, so a moving car leaves a trail behind it.
 */
export class VehicleSmoke {
  private readonly puffs: Puff[] = [];
  private readonly offsets = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  private readonly data = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  private readonly geometry = new InstancedBufferGeometry();
  private readonly mesh: Mesh;
  private readonly carry = new Map<number, number>();

  constructor(private readonly scene: Scene) {
    const plane = new PlaneGeometry(1, 1);
    this.geometry.index = plane.index;
    this.geometry.setAttribute('position', plane.getAttribute('position'));
    this.offsets.setUsage(DynamicDrawUsage); this.data.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('offset', this.offsets);
    this.geometry.setAttribute('puff', this.data);
    this.geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: NormalBlending,
      vertexShader: `
        attribute vec3 offset; attribute vec4 puff;
        varying vec2 vUv; varying float vAlpha; varying float vShade; varying float vSeed;
        void main() {
          vec4 mv = viewMatrix * vec4(offset, 1.0);
          float c = cos(puff.z), s = sin(puff.z);
          mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * puff.x;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy * 2.0; vAlpha = puff.y; vShade = fract(puff.w); vSeed = floor(puff.w) * 0.137;
        }`,
      fragmentShader: `
        varying vec2 vUv; varying float vAlpha; varying float vShade; varying float vSeed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float r = length(vUv);
          float n = noise(vUv * 2.2 + vSeed) * 0.6 + noise(vUv * 5.3 - vSeed) * 0.4;
          float a = 1.0 - smoothstep(0.15, 1.0, r + (n - 0.5) * 0.55);
          a *= a * vAlpha;
          if (a < 0.004) discard;
          // Slightly lighter, sunlit upper edge on otherwise sooty smoke.
          gl_FragColor = vec4(vec3(vShade * (0.8 + 0.35 * vUv.y + 0.25 * n)), a);
        }`,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /** severity 0..1 (1 = wrecked/burning); velocity is the vehicle's world velocity. */
  emit(id: number, dt: number, x: number, y: number, z: number, vx: number, vz: number, severity: number): void {
    const rate = severity >= 1 ? 42 : 5 + severity * 30;
    let budget = (this.carry.get(id) ?? Math.random()) + rate * dt;
    for (; budget >= 1 && this.puffs.length < MAX; budget--) {
      const life = 2.2 + Math.random() * 1.8 + severity * 1.2;
      this.puffs.push({
        x: x + (Math.random() - .5) * .4, y: y + Math.random() * .15, z: z + (Math.random() - .5) * .4,
        vx: vx * .55 + (Math.random() - .5) * .6, vy: 1 + Math.random() * .9 + severity * .8, vz: vz * .55 + (Math.random() - .5) * .6,
        age: 0, life, size: .3 + severity * .3, grow: 1.4 + severity * 2.2 + Math.random() * .8,
        alpha: .35 + severity * .45, spin: (Math.random() - .5) * .8, angle: Math.random() * Math.PI * 2,
        shade: .05 + Math.random() * .07 + (1 - severity) * .1,
      });
    }
    this.carry.set(id, Math.min(budget, 1));
  }

  update(dt: number): void {
    const drag = Math.exp(-dt * 1.7), lift = Math.exp(-dt * .45);
    let n = 0;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i]!;
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx = p.vx * drag + .45 * dt; p.vz = p.vz * drag + .2 * dt; p.vy = p.vy * lift + .35 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.angle += p.spin * dt;
      this.puffs[n++] = p;
    }
    this.puffs.length = n;
    const o = this.offsets.array as Float32Array, d = this.data.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[i]!, t = p.age / p.life;
      o[i * 3] = p.x; o[i * 3 + 1] = p.y; o[i * 3 + 2] = p.z;
      d[i * 4] = p.size + p.grow * Math.sqrt(t);
      d[i * 4 + 1] = p.alpha * Math.min(1, t * 8) * (1 - t) ** 1.6;
      d[i * 4 + 2] = p.angle;
      d[i * 4 + 3] = i % 97 + p.shade;
    }
    this.geometry.instanceCount = n;
    this.offsets.needsUpdate = true; this.data.needsUpdate = true;
  }

  forget(id: number): void { this.carry.delete(id); }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose(); (this.mesh.material as ShaderMaterial).dispose();
  }
}

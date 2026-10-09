import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, type Scene } from 'three';

const SEGMENTS = 48;
/** Arc swept by one cut (radians) and how long the trail lives (s). */
const ARC = 2.2;
const LIFE = 0.24;
const POOL = 6;
/** The trail appears this long after the swing starts, when the blade actually comes through (s). */
const DELAY = 0.4;

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// u runs along the arc (0 = start of the swing), v across it (0 = inner edge, 1 = blade edge).
const frag = /* glsl */ `
  uniform float uProgress;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float head = uProgress * 1.35;
    // Bright at the blade's current position, fading smoothly along the trail behind it.
    float trail = smoothstep(head - 0.75, head, vUv.x) * (1.0 - smoothstep(head, head + 0.04, vUv.x));
    // Thin, soft crescent: sharp bright line on the blade edge, feathered inside.
    float edge = smoothstep(0.0, 0.85, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
    float fade = 1.0 - smoothstep(0.7, 1.0, uProgress);
    float a = trail * edge * fade;
    vec3 col = mix(uColor, vec3(1.0), smoothstep(0.6, 0.95, vUv.y) * trail);
    gl_FragColor = vec4(col * a, a);
  }
`;

/** Crescent ribbon around −Z (so `rotation.y = yaw` faces it forward), tapering at both ends. */
function crescent(reach: number): BufferGeometry {
  const pos = new Float32Array((SEGMENTS + 1) * 2 * 3);
  const uv = new Float32Array((SEGMENTS + 1) * 2 * 2);
  const idx: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS;
    const a = ARC / 2 - u * ARC;
    const width = reach * 0.22 * Math.sin(Math.PI * u) + 0.01;
    const ro = reach;
    const ri = reach - width;
    for (const [k, r] of [[0, ri], [1, ro]] as const) {
      const j = i * 2 + k;
      pos.set([-Math.sin(a) * r, 0, -Math.cos(a) * r], j * 3);
      uv.set([u, k], j * 2);
    }
    if (i < SEGMENTS) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

interface Cut {
  mesh: Mesh;
  mat: ShaderMaterial;
  t: number;
  /** Waiting out the delay before it shows. */
  pending: boolean;
}

/** Blade swings: one smooth, wide and thin crescent trail per cut (pooled, additive). */
export class SlashEffects {
  private readonly cuts: Cut[] = [];
  private readonly geos = new Map<number, BufferGeometry>();
  private next = 0;

  constructor(private readonly scene: Scene) {
    for (let i = 0; i < POOL; i++) {
      const mat = new ShaderMaterial({
        uniforms: { uProgress: { value: 1 }, uColor: { value: new Color(0x9fc8ff) } },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.geometry(2), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 7;
      scene.add(mesh);
      this.cuts.push({ mesh, mat, t: LIFE, pending: false });
    }
  }

  private geometry(reach: number): BufferGeometry {
    const key = Math.round(reach * 10);
    let g = this.geos.get(key);
    if (!g) this.geos.set(key, (g = crescent(key / 10)));
    return g;
  }

  /**
   * A cut centred on (x, y, z) facing `yaw`, `reach` metres out, following the swing's pose:
   * 0 = vertical (overhead chop, top to bottom), 1 = horizontal (flat sweep), 2 = diagonal.
   */
  spawn(x: number, y: number, z: number, yaw: number, reach: number, variant = 1): void {
    const c = this.cuts[this.next++ % POOL]!;
    const vertical = variant === 0;
    c.mesh.geometry = this.geometry(vertical ? reach * 0.75 : reach);
    c.mesh.position.set(x, y + (vertical ? 0.25 : 0), z);
    // Roll the flat crescent about the facing axis: −90° stands it up so it sweeps top → bottom.
    const roll = vertical ? -Math.PI / 2 : variant === 2 ? -0.8 : 0.08;
    c.mesh.rotation.set(0, yaw, roll, 'YXZ');
    c.t = -DELAY;
    c.mat.uniforms.uProgress!.value = 0;
    c.mesh.visible = false;
    c.pending = true;
  }

  update(dt: number): void {
    for (const c of this.cuts) {
      if (c.pending) {
        c.t += dt;
        if (c.t < 0) continue;
        c.pending = false;
        c.mesh.visible = true;
      }
      if (!c.mesh.visible) continue;
      c.t += dt;
      if (c.t >= LIFE) {
        c.mesh.visible = false;
        continue;
      }
      c.mat.uniforms.uProgress!.value = c.t / LIFE;
    }
  }

  dispose(): void {
    for (const c of this.cuts) {
      this.scene.remove(c.mesh);
      c.mat.dispose();
    }
    for (const g of this.geos.values()) g.dispose();
  }
}

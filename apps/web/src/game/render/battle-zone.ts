import { Color, CylinderGeometry, DataTexture, DoubleSide, FloatType, LinearFilter, Mesh, MeshBasicMaterial, RedFormat, RepeatWrapping, ShaderMaterial, type Scene } from 'three';
import type { BattleState } from '@zion/shared';

const SAMPLES = 256;

/**
 * The safe-area wall: a red energy curtain with slow rising bands, strongest near the ground and
 * fading upward, and a white-hot seam where it meets the terrain (the ground height under the
 * ring is sampled into a small texture as the circle moves). It draws before other see-through
 * things (foliage), so leaves and trunks in front are never washed over in red. Before the drop a
 * small, brighter ring fences the lobby everyone waits in.
 */
export class BattleZone {
  private readonly geometry = new CylinderGeometry(1, 1, 240, 256, 1, true);
  private readonly heights = new Float32Array(SAMPLES);
  private readonly heightTex = new DataTexture(this.heights, SAMPLES, 1, RedFormat, FloatType);
  private readonly material = new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new Color(0xff202e) }, uGround: { value: this.heightTex } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vY;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vY = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform sampler2D uGround;
      varying vec2 vUv; varying float vY;
      void main() {
        float ground = texture2D(uGround, vec2(vUv.x, .5)).r;
        float above = vY - ground;
        if (above < -1.5) discard;
        // Rising energy bands and a fine shimmer.
        float bands = smoothstep(.55, 1., fract(vUv.x * 90. + vY * .035 - uTime * .25)) * .12;
        float shimmer = smoothstep(.8, 1., fract(vY * .5 - uTime * 1.6 + sin(vUv.x * 900.) * .2)) * .05;
        float body = (.16 + bands + shimmer) * (1. - smoothstep(20., 200., above));
        // White-hot seam where the wall meets the ground, pulsing softly.
        float seam = exp(-max(above, 0.) / 1.8) * (.75 + .25 * sin(uTime * 4. + vUv.x * 60.));
        vec3 colour = mix(uColor, vec3(1.), clamp(seam * 1.2, 0., 1.));
        gl_FragColor = vec4(colour, clamp(body + seam * .85, 0., .95));
      }`,
  });
  private readonly wall = new Mesh(this.geometry, this.material);
  private readonly lobbyMaterial = new MeshBasicMaterial({ color: 0xff2a36, transparent: true, opacity: .38, side: DoubleSide, depthWrite: false });
  private readonly lobby = new Mesh(this.geometry, this.lobbyMaterial);
  private sampled = { x: NaN, z: NaN, r: NaN };
  private readonly started = performance.now();

  constructor(private readonly scene: Scene, private readonly groundAt: (x: number, z: number) => number = () => 0) {
    this.heightTex.wrapS = RepeatWrapping; this.heightTex.magFilter = LinearFilter; this.heightTex.minFilter = LinearFilter;
    for (const m of [this.wall, this.lobby]) { m.visible = false; m.frustumCulled = false; m.renderOrder = -1; scene.add(m); }
  }

  update(state: BattleState): void {
    const ring = (state.phase === 'waiting' || state.phase === 'countdown') ? state.lobby : undefined;
    this.lobby.visible = !!ring;
    if (ring) { this.lobby.position.set(ring.x, 100, ring.z); this.lobby.scale.set(ring.radius, 1, ring.radius); }
    const c = state.circle, r = Math.max(.01, c.radius);
    this.wall.visible = state.phase === 'running';
    this.wall.position.set(c.x, 100, c.z);
    this.wall.scale.set(r, 1, r);
    this.material.uniforms.uTime!.value = (performance.now() - this.started) / 1000;
    // Ground under the ring, re-sampled when the circle has moved or shrunk a little.
    const s = this.sampled;
    if (this.wall.visible && !(Math.abs(s.x - c.x) < 1 && Math.abs(s.z - c.z) < 1 && Math.abs(s.r - r) < 1)) {
      for (let i = 0; i < SAMPLES; i++) {
        // CylinderGeometry: u runs round from +Z towards +X (theta = u·2π, x = sin, z = cos).
        const a = i / SAMPLES * Math.PI * 2, h = this.groundAt(c.x + Math.sin(a) * r, c.z + Math.cos(a) * r);
        this.heights[i] = Number.isFinite(h) ? h : 0;
      }
      this.heightTex.needsUpdate = true;
      this.sampled = { x: c.x, z: c.z, r };
    }
  }

  dispose(): void { this.scene.remove(this.wall, this.lobby); this.geometry.dispose(); this.material.dispose(); this.lobbyMaterial.dispose(); this.heightTex.dispose(); }
}

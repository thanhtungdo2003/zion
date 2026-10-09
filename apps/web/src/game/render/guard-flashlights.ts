import {
  AdditiveBlending, Color, ConeGeometry, DoubleSide, Mesh, ShaderMaterial, SpotLight, type Scene,
} from 'three';

const POOL = 3;
const RANGE = 26;
const ANGLE = 0.36;
/** Flashlight is held at chest height, slightly in front of the body. */
const HAND_HEIGHT = 1.35;
const HAND_FORWARD = 0.45;

const beamVertex = /* glsl */ `
  varying float vAlong;
  void main() {
    vAlong = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vAlong;
  void main() {
    float a = pow(vAlong, 2.2) * uStrength;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export interface FlashlightPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/**
 * Guards' night flashlights: a fixed pool of spot lights (so the shader light count never
 * changes) plus a faint additive cone that makes the beam visible in the air.
 */
export class GuardFlashlights {
  private readonly lights: SpotLight[] = [];
  private readonly beams: Mesh[] = [];
  private readonly material: ShaderMaterial;

  constructor(private readonly scene: Scene) {
    const color = new Color(0xfff1d6);
    const length = RANGE * 0.55;
    const geometry = new ConeGeometry(Math.tan(ANGLE) * length, length, 24, 1, true);
    geometry.translate(0, -length / 2, 0);
    geometry.rotateX(-Math.PI / 2); // apex at the origin, opening along +Z (the lookAt axis)
    this.material = new ShaderMaterial({
      uniforms: { uColor: { value: color }, uStrength: { value: 0 } },
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    for (let i = 0; i < POOL; i++) {
      const light = new SpotLight(color, 0, RANGE, ANGLE, 0.55, 1.4);
      light.castShadow = false;
      scene.add(light, light.target);
      this.lights.push(light);
      const beam = new Mesh(geometry, this.material);
      beam.visible = false;
      beam.frustumCulled = false;
      beam.renderOrder = 5;
      scene.add(beam);
      this.beams.push(beam);
    }
  }

  /** `darkness` is 0 by day … 1 at night; guards switch their lights on as it gets dark. */
  update(guards: readonly FlashlightPose[], darkness: number): void {
    const on = Math.min(1, Math.max(0, (darkness - 0.15) / 0.35));
    this.material.uniforms.uStrength!.value = 0.12 * on;
    for (let i = 0; i < POOL; i++) {
      const light = this.lights[i]!;
      const beam = this.beams[i]!;
      const g = guards[i];
      if (!g || on <= 0) {
        light.intensity = 0;
        beam.visible = false;
        continue;
      }
      // Model faces −Z at yaw 0; pitch tilts the beam with the aim, dipped a little to light the ground.
      const pitch = g.pitch - 0.18;
      const fx = -Math.sin(g.yaw) * Math.cos(pitch);
      const fy = Math.sin(pitch);
      const fz = -Math.cos(g.yaw) * Math.cos(pitch);
      const ox = g.x + fx * HAND_FORWARD, oy = g.y + HAND_HEIGHT, oz = g.z + fz * HAND_FORWARD;
      light.intensity = 70 * on;
      light.position.set(ox, oy, oz);
      light.target.position.set(ox + fx * 10, oy + fy * 10, oz + fz * 10);
      light.target.updateMatrixWorld();
      beam.visible = true;
      beam.position.set(ox, oy, oz);
      beam.lookAt(light.target.position);
    }
  }

  dispose(): void {
    for (const light of this.lights) { this.scene.remove(light, light.target); light.dispose(); }
    for (const beam of this.beams) this.scene.remove(beam);
    this.beams[0]?.geometry.dispose();
    this.material.dispose();
  }
}

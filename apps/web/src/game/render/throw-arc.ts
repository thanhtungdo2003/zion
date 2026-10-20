import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3, type Camera } from 'three';

/**
 * Predicted flight of a thrown grenade or a lobbed launcher round: a faint ribbon from the hand /
 * muzzle to where it comes down, with soft dashes drifting forward along the path. The path is
 * the same ballistic arc the server launches (origin, elevation, speed and gravity).
 */

const SEGMENTS = 48;
const WIDTH = 0.07;

const vertex = /* glsl */ `
  attribute float along;
  attribute float side;
  varying float vAlong;
  varying float vSide;
  void main() {
    vAlong = along;
    vSide = side;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uLength;
  varying float vAlong;
  varying float vSide;
  void main() {
    float metres = vAlong * uLength;
    // Dashes 0.6 m apart, flowing towards the landing point.
    float dash = smoothstep(0.15, 0.5, fract(metres / 0.6 - uTime * 2.2)) * smoothstep(1.0, 0.6, fract(metres / 0.6 - uTime * 2.2));
    float edge = 1.0 - abs(vSide);
    float ends = smoothstep(0.0, 0.06, vAlong) * smoothstep(1.0, 0.9, vAlong);
    float alpha = (0.12 + 0.28 * dash) * edge * ends;
    gl_FragColor = vec4(vec3(1.0, 0.96, 0.88), alpha);
  }
`;

export interface ArcLaunch {
  origin: Vector3;
  /** Horizontal unit direction (x, z). */
  dirX: number;
  dirZ: number;
  speed: number;
  elevation: number;
  gravity: number;
  /** Ground height at the aimed point: the arc ends when it comes down to it. */
  groundY: number;
}

export class ThrowArc {
  readonly mesh: Mesh;
  private readonly points = Array.from({ length: SEGMENTS + 1 }, () => new Vector3());
  private readonly material = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLength: { value: 1 } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
  });
  private readonly side = new Vector3();
  private readonly tangent = new Vector3();
  private readonly view = new Vector3();

  constructor() {
    const geometry = new BufferGeometry();
    const n = (SEGMENTS + 1) * 2;
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    const along = new Float32Array(n), side = new Float32Array(n);
    for (let i = 0; i <= SEGMENTS; i++) {
      along[i * 2] = along[i * 2 + 1] = i / SEGMENTS;
      side[i * 2] = -1; side[i * 2 + 1] = 1;
    }
    geometry.setAttribute('along', new BufferAttribute(along, 1));
    geometry.setAttribute('side', new BufferAttribute(side, 1));
    const index: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geometry.setIndex(index);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** Flight time until the arc comes back down to `groundY` (or its apex if it never does). */
  static flightTime(l: ArcLaunch): number {
    const vy = Math.sin(l.elevation) * l.speed;
    const dy = l.origin.y - l.groundY;
    const disc = vy * vy + 2 * l.gravity * dy;
    return disc >= 0 ? (vy + Math.sqrt(disc)) / l.gravity : vy / l.gravity;
  }

  /** Point of the arc at time `t`. */
  static at(l: ArcLaunch, t: number, out: Vector3): Vector3 {
    const h = Math.cos(l.elevation) * l.speed, vy = Math.sin(l.elevation) * l.speed;
    return out.set(l.origin.x + l.dirX * h * t, l.origin.y + vy * t - 0.5 * l.gravity * t * t, l.origin.z + l.dirZ * h * t);
  }

  update(launch: ArcLaunch, camera: Camera, time: number): void {
    const total = ThrowArc.flightTime(launch);
    let length = 0;
    for (let i = 0; i <= SEGMENTS; i++) {
      ThrowArc.at(launch, (total * i) / SEGMENTS, this.points[i]!);
      if (i) length += this.points[i]!.distanceTo(this.points[i - 1]!);
    }
    const pos = this.mesh.geometry.getAttribute('position') as BufferAttribute;
    camera.getWorldPosition(this.view);
    const eye = this.view.clone();
    for (let i = 0; i <= SEGMENTS; i++) {
      const p = this.points[i]!;
      this.tangent.subVectors(this.points[Math.min(SEGMENTS, i + 1)]!, this.points[Math.max(0, i - 1)]!).normalize();
      // Ribbon faces the camera.
      this.side.crossVectors(this.tangent, this.view.subVectors(eye, p)).normalize().multiplyScalar(WIDTH / 2);
      pos.setXYZ(i * 2, p.x - this.side.x, p.y - this.side.y, p.z - this.side.z);
      pos.setXYZ(i * 2 + 1, p.x + this.side.x, p.y + this.side.y, p.z + this.side.z);
    }
    pos.needsUpdate = true;
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uLength!.value = Math.max(0.1, length);
    this.mesh.visible = true;
  }

  /** Where the arc comes down. */
  static landing(launch: ArcLaunch, out: Vector3): Vector3 {
    return ThrowArc.at(launch, ThrowArc.flightTime(launch), out);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

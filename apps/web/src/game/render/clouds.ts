import {
  type BufferGeometry,
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, hash2, hashToUnit } from '@zion/shared';

const CELL = 170;
const RANGE = 6; // cells each side
const MAX = (RANGE * 2 + 1) ** 2;
const ALTITUDE = 330;
const WIND = new Vector3(4.2, 0, 1.6); // m/s

function puffGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const count = 6 + rng.int(5);
  for (let i = 0; i < count; i++) {
    const r = 10 + rng.next() * 14;
    const g = new IcosahedronGeometry(r, 1);
    g.scale(1, 0.55, 1);
    g.translate((rng.next() - 0.5) * 60, (rng.next() - 0.3) * 8, (rng.next() - 0.5) * 34);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
}

/**
 * Cosmetic cloud layer. Cloud placement is a pure function of the server-provided cosmetic seed
 * and server time, so every client sees the same sky without any network traffic.
 */
export class CloudLayer {
  private readonly mesh: InstancedMesh;
  private readonly material: MeshLambertMaterial;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private readonly tint = new Color();

  constructor(
    scene: Scene,
    private readonly seed: number,
  ) {
    this.material = new MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false });
    this.material.emissive = new Color(0x000000);
    this.mesh = new InstancedMesh(puffGeometry(seed), this.material, MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    scene.add(this.mesh);
  }

  /** `serverSeconds` is the shared server clock; `light` 0..1 scene brightness. */
  update(camX: number, camZ: number, serverSeconds: number, light: number, horizon: Color): void {
    const ox = WIND.x * serverSeconds;
    const oz = WIND.z * serverSeconds;
    // Cloud field lives in wind space; find the cells around the camera there.
    const cx = Math.floor((camX - ox) / CELL);
    const cz = Math.floor((camZ - oz) / CELL);
    // Coverage drifts slowly over time (weather), from ~25% to ~65%.
    const coverage = 0.45 + 0.2 * Math.sin(serverSeconds / 900 + hashToUnit(this.seed) * 6.28);
    let n = 0;
    for (let dz = -RANGE; dz <= RANGE; dz++) {
      for (let dx = -RANGE; dx <= RANGE; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        const h = hash2(this.seed, gx, gz);
        if (hashToUnit(h) > coverage) continue;
        const r = new Rng(h);
        const x = (gx + r.next()) * CELL + ox;
        const z = (gz + r.next()) * CELL + oz;
        const scale = 0.7 + r.next() * 0.9;
        this.p.set(x, ALTITUDE + r.next() * 50, z);
        this.q.setFromAxisAngle(new Vector3(0, 1, 0), r.next() * Math.PI * 2);
        this.s.set(scale, scale * (0.8 + r.next() * 0.4), scale);
        this.m.compose(this.p, this.q, this.s);
        this.mesh.setMatrixAt(n++, this.m);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Night clouds pick up the dark sky; sunset clouds pick up the warm horizon.
    this.tint.setRGB(1, 1, 1).lerp(horizon, 0.35).multiplyScalar(0.25 + 0.75 * light);
    this.material.color.copy(this.tint);
    this.material.emissive.copy(horizon).multiplyScalar(0.25 * (1 - light) + 0.12);
  }
}

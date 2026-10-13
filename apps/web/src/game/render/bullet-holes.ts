import { DataTexture, Mesh, MeshBasicMaterial, PlaneGeometry, RGBAFormat, SRGBColorSpace, Vector3, type Scene } from 'three';

const LIFETIME_MS = 60_000;
const MAX_MARKS = 512;

/** Small reusable texture: chipped rim, dark centre and transparent outer edge. */
function holeTexture(): DataTexture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5 - size / 2) / (size / 2), v = (y + .5 - size / 2) / (size / 2);
    const angle = Math.atan2(v, u);
    const noise = ((Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263)) >>> 0) / 0xffffffff;
    const r = Math.hypot(u, v) / (1 + .08 * Math.sin(angle * 7) + .06 * Math.sin(angle * 13));
    const crack = Math.abs(Math.sin(angle * 5 + .6 * Math.sin(r * 8))) < .025 && r < .86;
    const core = r < .24 + noise * .035;
    const rim = Math.max(0, 1 - Math.abs(r - .32) / .14);
    const soot = Math.max(0, 1 - r / .72);
    const shade = core ? 15 + noise * 12 : 65 + rim * 75 + noise * 40;
    const alpha = core ? .94 : crack ? .6 : Math.min(.8, rim * .65 + soot * .38) * (.7 + noise * .3);
    const i = (y * size + x) * 4;
    pixels[i] = shade; pixels[i + 1] = shade * .94; pixels[i + 2] = shade * .86;
    pixels[i + 3] = Math.round(alpha * 255);
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Cosmetic texture overlays; they never alter the object's geometry or collision. */
export class BulletHoles {
  private readonly texture = holeTexture();
  private readonly geometry = new PlaneGeometry(.16, .16);
  private readonly material = new MeshBasicMaterial({
    map: this.texture, transparent: true, alphaTest: .02, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  private readonly marks: Array<{ mesh: Mesh; expiresAt: number }> = [];
  private next = 0;
  private disposed = false;
  private readonly normal = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);

  constructor(private readonly scene: Scene, private readonly now = () => performance.now()) {}

  add(x: number, y: number, z: number, normal: readonly [number, number, number]): void {
    if (this.disposed || ![x, y, z, ...normal].every(Number.isFinite)) return;
    this.normal.set(...normal);
    if (this.normal.lengthSq() < 1e-8) return;
    this.normal.normalize();
    const index = this.next++ % MAX_MARKS;
    let mark = this.marks[index];
    if (!mark) {
      mark = { mesh: new Mesh(this.geometry, this.material), expiresAt: 0 };
      mark.mesh.name = 'bullet-hole';
      this.marks[index] = mark;
    }
    mark.mesh.position.set(x, y, z).addScaledVector(this.normal, .002);
    mark.mesh.quaternion.setFromUnitVectors(this.forward, this.normal);
    mark.mesh.rotateZ(Math.random() * Math.PI * 2);
    mark.mesh.scale.setScalar(.8 + Math.random() * .4);
    mark.expiresAt = this.now() + LIFETIME_MS;
    this.scene.add(mark.mesh);
  }

  update(): void {
    const now = this.now();
    for (const mark of this.marks) if (mark.mesh.parent && now >= mark.expiresAt) mark.mesh.removeFromParent();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mark of this.marks) mark.mesh.removeFromParent();
    this.marks.length = 0;
    this.geometry.dispose(); this.material.dispose(); this.texture.dispose();
  }
}

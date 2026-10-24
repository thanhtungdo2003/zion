import { Group, Mesh, type MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { cachedFetch } from '@/lib/preload';
import { applyDrags, dragsFor, softFor } from '../gear-fit';
import { shapeFromWeights, softShape, SoftTail } from './soft-tail';

/**
 * The worn backpack (models/gear/military-backpack.glb): loaded once, then each wearer gets an
 * instance that hangs from its shoulder straps and moves like a loaded pack: it lags behind the
 * body when it speeds up, stops or turns, settles with a little wobble (a damped spring), hangs
 * towards the ground when the body leans, and never swings into the back. The loose strap ends
 * below it hang down and swing on their own spring (bent in the vertex shader).
 *
 * Frame of an instance: origin where the straps leave the shoulders, +Y up, +Z away from the
 * back (the pack's outside), the pack's straps facing −Z (the wearer). Real-size metres.
 */
export const BACKPACK_URL = '/models/gear/military-backpack.glb';
/** The source faces its straps 48° round from +Z (measured on the model). */
const SOURCE_YAW = 48 * Math.PI / 180;
/** Height of the pack (m, real size). */
const PACK_HEIGHT = .56;

interface Template {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  /** The strap tails below the pack's bottom, as softness weights (used when the Studio has painted none). */
  tails: Float32Array;
  /** Half width / depth / bottom of the pack body (pack frame), for the rifle mounts. */
  half: number; depth: number; bottom: number;
}

let template: Promise<Template> | null = null;

function loadTemplate(): Promise<Template> {
  template ??= (async () => {
    const buffer = await (await cachedFetch(BACKPACK_URL)).arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    let mesh: Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh; });
    if (!mesh) throw new Error('backpack model has no mesh');
    const src = mesh as Mesh;
    const geometry = (src.geometry as BufferGeometry).clone().applyMatrix4(src.matrixWorld);
    // Straps towards −Z (the wearer), top of the straps at the origin, real size.
    geometry.rotateY(SOURCE_YAW + Math.PI);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const s = PACK_HEIGHT / (box.max.y - box.min.y);
    // Zero at the back panel (the middle of the pack body), not at the strap loops that reach
    // forward over the shoulders: the panel then rests on the wearer's back.
    const p0 = geometry.getAttribute('position'), panel: number[] = [], h = box.max.y - box.min.y, w = box.max.x - box.min.x;
    for (let i = 0; i < p0.count; i++) {
      const y = p0.getY(i), x = p0.getX(i) - (box.max.x + box.min.x) / 2;
      if (y > box.min.y + h * .3 && y < box.min.y + h * .75 && Math.abs(x) < w * .06) panel.push(p0.getZ(i));
    }
    panel.sort((a, b) => a - b);
    const back = panel.length ? panel[Math.floor(panel.length * .1)]! : box.min.z;
    geometry.translate(-(box.max.x + box.min.x) / 2, -box.max.y, -back);
    geometry.scale(s, s, s);
    geometry.computeBoundingBox();
    const b = geometry.boundingBox!;
    // Loose strap ends: on the strap side (near −Z), below the pack's bottom edge.
    const pos = geometry.getAttribute('position'), dangle = new Float32Array(pos.count);
    const depth = b.max.z - b.min.z, height = b.max.y - b.min.y, tailRoot = b.min.y + height * .13;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);
      const strapSide = z < b.min.z + depth * .38;
      dangle[i] = strapSide && y < tailRoot ? Math.min(1, (tailRoot - y) / (height * .1)) : 0;
    }
    const material = (Array.isArray(src.material) ? src.material[0]! : src.material) as MeshStandardMaterial;
    return { geometry, material, tails: dangle, half: (b.max.x - b.min.x) / 2, depth, bottom: b.min.y };
  })().catch((err: unknown) => { template = null; throw err; });
  return template;
}

/** Spring constants: the pack (heavier, slower) and the strap ends (light, quick). */
/**
 * Strapped tight: the pack rests with its bottom pressed into the small of the back (`rest`, about
 * the straps), hangs only a little towards the ground when the body leans, and swings out only a
 * little when the body speeds up or stops.
 */
const PACK = { omega: 9, damping: .45, accelGain: .006, lean: .08, outward: .06, inward: .14, side: .08, rest: -.1 };
/** Acceleration is smoothed over ~1/6 s: the stride's bounce must not swing the pack. */
const ACCEL_SMOOTHING = 6;

export class BackpackInstance {
  /** Attach to the wearer's chest hook (+Z out of the back, +Y up). */
  readonly root = new Group();
  /** The swinging pack, pivoting at the straps. */
  private readonly pack = new Group();
  /** Where long guns hang: each side muzzle down, one across the top. */
  readonly rifleMounts = { left: new Group(), right: new Group(), top: new Group() };
  private material: MeshStandardMaterial | null = null;
  /** The loose strap ends (painted in the Studio, else the ends below the pack). */
  private tail: SoftTail | null = null;
  /** The pack's mesh (the Studio paints and adjusts it). */
  mesh: Mesh | null = null;
  private disposed = false;
  // Spring state: pack pitch (about +X) and roll (about +Z), strap ends (rotation vector x/z).
  private pitch = PACK.rest; private pitchV = 0; private roll = 0; private rollV = 0;
  private readonly lastPos = new Vector3(); private readonly lastVel = new Vector3(); private primed = 0;
  private readonly accel = new Vector3();

  constructor(onReady?: () => void) {
    this.root.name = 'backpack';
    this.root.add(this.pack);
    this.rifleMounts.left.name = 'backpack-rifle-left';
    this.rifleMounts.right.name = 'backpack-rifle-right';
    this.rifleMounts.top.name = 'backpack-rifle-top';
    this.pack.add(this.rifleMounts.left, this.rifleMounts.right, this.rifleMounts.top);
    void loadTemplate().then((t) => {
      if (this.disposed) return;
      const material = t.material.clone();
      // Painted soft regions (Studio) replace the automatic strap ends.
      const painted = softFor('military_backpack').find((r) => r.mesh === 0);
      const geometry = t.geometry.clone();
      // Hand pulls from the Studio (straps brought over the shoulders).
      applyDrags(geometry, dragsFor('military_backpack', 0));
      const shape = painted ? softShape(geometry, painted.vertices) : shapeFromWeights(geometry, t.tails);
      if (shape) { this.tail = new SoftTail(geometry, shape, painted?.stiffness ?? .3); this.tail.patch(material); }
      this.material = material;
      const mesh = new Mesh(geometry, material);
      mesh.name = 'backpack-mesh';
      this.mesh = mesh;
      mesh.castShadow = true;
      this.pack.add(mesh);
      // Rifle mounts: on the pack's sides half way down, and across its top.
      // Low on the sides: the muzzles hang down past the pack's bottom towards the hips.
      this.rifleMounts.left.position.set(t.half + .015, t.bottom * .92, t.depth * .55);
      this.rifleMounts.right.position.set(-t.half - .015, t.bottom * .92, t.depth * .55);
      this.rifleMounts.top.position.set(0, .03, t.depth * .55);
      onReady?.();
    }).catch(() => { /* No pack model: the gear still works without it. */ });
  }

  /**
   * Moves the pack after the wearer is posed this frame: `hook` is the object it hangs from.
   * Its world acceleration swings the pack (and faster, the strap ends); gravity pulls both down.
   */
  update(hook: Object3D, dt: number): void {
    if (dt <= 0) return;
    const q = hook.getWorldQuaternion(new Quaternion()), inv = q.clone().invert();
    const p = hook.getWorldPosition(new Vector3());
    const vel = this.primed > 0 ? p.clone().sub(this.lastPos).divideScalar(dt) : new Vector3();
    const raw = this.primed > 1 ? vel.clone().sub(this.lastVel).divideScalar(dt) : new Vector3();
    this.lastPos.copy(p); this.lastVel.copy(vel); this.primed = Math.min(2, this.primed + 1);
    // Teleports / respawns: no swing from one huge step. Then low-passed (speeding up, stopping
    // and turning swing it; the up-and-down of each stride does not).
    if (raw.lengthSq() > 2500) raw.set(0, 0, 0);
    this.accel.lerp(raw, 1 - Math.exp(-dt * ACCEL_SMOOTHING));
    const acc = this.accel.clone();
    const local = acc.clone().applyQuaternion(inv), down = new Vector3(0, -1, 0).applyQuaternion(inv);
    // Gravity: hang towards the ground (partly; the straps hold it to the back), then inertia.
    const gravityPitch = Math.asin(Math.max(-1, Math.min(1, down.z))) * PACK.lean, gravityRoll = -Math.asin(Math.max(-1, Math.min(1, down.x))) * PACK.lean * .5;
    const pitchTarget = Math.max(-PACK.inward, Math.min(PACK.outward, PACK.rest + gravityPitch - local.z * PACK.accelGain));
    const rollTarget = Math.max(-PACK.side, Math.min(PACK.side, gravityRoll - local.x * PACK.accelGain));
    [this.pitch, this.pitchV] = step(this.pitch, this.pitchV, pitchTarget, PACK.omega, PACK.damping, dt);
    [this.roll, this.rollV] = step(this.roll, this.rollV, rollTarget, PACK.omega, PACK.damping, dt);
    // Bottom swinging out from the back is +pitch (about −X here: the pack's outside is +Z).
    this.pack.rotation.set(-Math.max(-PACK.inward, Math.min(PACK.outward, this.pitch)), 0, Math.max(-PACK.side, Math.min(PACK.side, this.roll)));
    // Strap ends: hang straight down whatever the pack does, and swing behind its motion.
    this.pack.updateWorldMatrix(true, true);
    if (this.tail && this.mesh) this.tail.update(this.mesh, dt);
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    (this.material as Material | null)?.dispose();
  }
}

/** One step of a damped spring (semi-implicit Euler, substepped for stability). */
function step(x: number, v: number, target: number, omega: number, zeta: number, dt: number): [number, number] {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v += (omega * omega * (target - x) - 2 * zeta * omega * v) * h;
    x += v * h;
  }
  return [x, v];
}

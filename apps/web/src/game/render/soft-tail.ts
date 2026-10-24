import { BufferAttribute, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';

/**
 * Loose parts of a rigid model (strap ends, cords, cloth tails) that hang under gravity and swing.
 *
 * The soft vertices are split into separate pieces (each strap end on its own). A piece is held at
 * its root (where it joins the rigid model) and is modelled as a short hanging cord: its direction
 * from the root (as modelled, possibly sticking out sideways) is turned onto a hanging direction
 * that a damped spring drives towards gravity and away from the model's acceleration. The turn is
 * applied in full at the free end and fades to nothing at the root, so the piece bends down from
 * where it is attached rather than swinging as a stiff stick.
 */
export interface SoftShape {
  /** 0 at the root … 1 at the free end, per vertex (0 = rigid). */
  weights: Float32Array;
  /** Piece index per vertex (0…3). */
  piece: Float32Array;
  pieces: Array<{ root: Vector3; dir: Vector3 }>;
}

const MAX_PIECES = 4;

/** Welded position key (seams and flat-shaded corners share a point). */
const keyOf = (x: number, y: number, z: number) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;

/**
 * Soft pieces from soft vertices: connected parts of the painted set; each piece's root is where it
 * touches the rigid rest (or, unattached, its highest part).
 */
export function softShape(geometry: BufferGeometry, vertices: readonly number[]): SoftShape | null {
  const pos = geometry.getAttribute('position'), index = geometry.getIndex();
  const soft = new Set(vertices.filter((i) => i < pos.count));
  if (!soft.size) return null;
  // Weld by position so seams do not cut a strap into pieces.
  const weld = new Int32Array(pos.count), ids = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) { const k = keyOf(pos.getX(i), pos.getY(i), pos.getZ(i)); let w = ids.get(k); if (w === undefined) { w = ids.size; ids.set(k, w); } weld[i] = w; }
  const softW = new Set([...soft].map((i) => weld[i]!));
  const nb = new Map<number, Set<number>>(), touchesRigid = new Set<number>();
  const tri = index ? index.count / 3 : pos.count / 3, corner = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < tri; t++) for (let k = 0; k < 3; k++) {
    const a = weld[corner(t, k)]!, b = weld[corner(t, (k + 1) % 3)]!;
    if (a === b) continue;
    const sa = softW.has(a), sb = softW.has(b);
    if (sa && sb) { (nb.get(a) ?? nb.set(a, new Set()).get(a)!).add(b); (nb.get(b) ?? nb.set(b, new Set()).get(b)!).add(a); }
    else if (sa) touchesRigid.add(a); else if (sb) touchesRigid.add(b);
  }
  // Connected pieces, biggest first.
  const comp = new Map<number, number>(), groups: number[][] = [];
  for (const w of softW) {
    if (comp.has(w)) continue;
    const list = [w]; comp.set(w, groups.length);
    for (let q = 0; q < list.length; q++) for (const n of nb.get(list[q]!) ?? []) if (!comp.has(n)) { comp.set(n, groups.length); list.push(n); }
    groups.push(list);
  }
  const order = groups.map((g, i) => [g.length, i] as const).sort((a, b) => b[0] - a[0]).slice(0, MAX_PIECES).map(([, i]) => i);
  const point = new Map<number, Vector3>();
  for (let i = 0; i < pos.count; i++) if (!point.has(weld[i]!)) point.set(weld[i]!, new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  const pieces: SoftShape['pieces'] = [], dist = new Map<number, number>(), pieceOf = new Map<number, number>();
  order.forEach((g, p) => {
    const members = groups[g]!;
    let roots = members.filter((w) => touchesRigid.has(w));
    if (!roots.length) { const top = Math.max(...members.map((w) => point.get(w)!.y)); roots = members.filter((w) => point.get(w)!.y > top - .01); }
    const root = roots.reduce((s, w) => s.add(point.get(w)!), new Vector3()).divideScalar(roots.length);
    let far = 0;
    for (const w of members) { const d = point.get(w)!.distanceTo(root); dist.set(w, d); far = Math.max(far, d); pieceOf.set(w, p); }
    const tip = members.filter((w) => dist.get(w)! > far * .8).reduce((s, w) => s.add(point.get(w)!), new Vector3()).divideScalar(Math.max(1, members.filter((w) => dist.get(w)! > far * .8).length));
    for (const w of members) dist.set(w, far > 1e-5 ? dist.get(w)! / far : 0);
    pieces.push({ root, dir: tip.sub(root).normalize() });
  });
  const weights = new Float32Array(pos.count), piece = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const w = weld[i]!;
    if (!pieceOf.has(w)) continue;
    const t = dist.get(w)!;
    weights[i] = t * t * (3 - 2 * t) * .85 + t * .15;
    piece[i] = pieceOf.get(w)!;
  }
  return { weights, piece, pieces };
}

/** The backpack's own rule (no painted region): strap ends below the pack's bottom edge. */
export function shapeFromWeights(geometry: BufferGeometry, weights: Float32Array): SoftShape | null {
  const list: number[] = [];
  for (let i = 0; i < weights.length; i++) if (weights[i]! > 0) list.push(i);
  return softShape(geometry, list);
}

const STEP = 1 / 120;
const DOWN = new Vector3(0, -1, 0);

export class SoftTail {
  /** Per piece: the root (pivot) and the turn applied at the free end (axis × angle). */
  private readonly pivots = { value: Array.from({ length: MAX_PIECES }, () => new Vector3()) };
  private readonly turns = { value: Array.from({ length: MAX_PIECES }, () => new Vector3()) };
  private readonly state: Array<{ rest: Vector3; dir: Vector3; vel: Vector3 }>;
  private readonly last = new Vector3(); private readonly lastVel = new Vector3(); private readonly accel = new Vector3(); private primed = 0;
  private readonly omega: number; private readonly damping: number; private readonly gain: number;

  /** `stiffness` 0 limp … 1 stiff (a stiff piece keeps more of its modelled direction). */
  constructor(geometry: BufferGeometry, shape: SoftShape, private readonly stiffness = .35) {
    geometry.setAttribute('aDangle', new BufferAttribute(shape.weights, 1));
    geometry.setAttribute('aSoftPiece', new BufferAttribute(shape.piece, 1));
    this.state = shape.pieces.map((p, i) => {
      this.pivots.value[i]!.copy(p.root);
      return { rest: p.dir.clone(), dir: p.dir.clone(), vel: new Vector3() };
    });
    this.omega = 7 + 12 * stiffness;
    this.damping = .25 + .35 * stiffness;
    this.gain = .03 * (1 - stiffness * .7);
  }

  /** Bends the material's vertices (call on a material owned by this model). */
  patch(material: Material): void {
    const before = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      shader.uniforms.uSoftPivot = this.pivots;
      shader.uniforms.uSoftTurn = this.turns;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aDangle;
attribute float aSoftPiece;
uniform vec3 uSoftPivot[${MAX_PIECES}];
uniform vec3 uSoftTurn[${MAX_PIECES}];`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aDangle > 0.0) {
          // Turned about the piece's root, fully at the free end, not at all at the root.
          int p = int(aSoftPiece + 0.5);
          vec3 turn = uSoftTurn[0], pivot = uSoftPivot[0];
          if (p == 1) { turn = uSoftTurn[1]; pivot = uSoftPivot[1]; }
          else if (p == 2) { turn = uSoftTurn[2]; pivot = uSoftPivot[2]; }
          else if (p == 3) { turn = uSoftTurn[3]; pivot = uSoftPivot[3]; }
          float ang = length(turn) * aDangle;
          if (ang > 1e-4) {
            vec3 k = normalize(turn), r = transformed - pivot;
            transformed = pivot + r * cos(ang) + cross(k, r) * sin(ang) + k * dot(k, r) * (1.0 - cos(ang));
          }
        }`);
    };
    material.customProgramCacheKey = () => 'soft-tail-2';
    material.needsUpdate = true;
  }

  /** After the model is posed: `frame` is the object whose local space the vertices are in. */
  update(frame: Object3D, dt: number): void {
    if (dt <= 0) return;
    const p = frame.getWorldPosition(new Vector3()), q = frame.getWorldQuaternion(new Quaternion()).invert();
    const vel = this.primed > 0 ? p.clone().sub(this.last).divideScalar(dt) : new Vector3();
    const raw = this.primed > 1 ? vel.clone().sub(this.lastVel).divideScalar(dt) : new Vector3();
    this.last.copy(p); this.lastVel.copy(vel); this.primed = Math.min(2, this.primed + 1);
    if (raw.lengthSq() > 2500) raw.set(0, 0, 0);
    this.accel.lerp(raw, 1 - Math.exp(-dt * 8));
    // Where a free cord would hang in the model's frame: down, pushed back by acceleration.
    const hang = DOWN.clone().applyQuaternion(q).addScaledVector(this.accel.clone().applyQuaternion(q), -this.gain).normalize();
    const n = Math.max(1, Math.ceil(dt / STEP)), h = dt / n, w = this.omega, c = 2 * this.damping * w;
    this.state.forEach((s, i) => {
      // A stiff piece keeps some of its modelled direction.
      const want = hang.clone().lerp(s.rest, this.stiffness * .6).normalize();
      for (let k = 0; k < n; k++) {
        s.vel.addScaledVector(want.clone().sub(s.dir), w * w * h).addScaledVector(s.vel, -c * h);
        s.dir.addScaledVector(s.vel, h).normalize();
      }
      // The turn from the modelled direction onto the hanging one, as axis × angle.
      const axis = new Vector3().crossVectors(s.rest, s.dir), sin = axis.length(), cos = s.rest.dot(s.dir);
      this.turns.value[i]!.copy(sin > 1e-6 ? axis.multiplyScalar(Math.atan2(sin, cos) / sin) : axis.set(0, 0, 0));
    });
  }
}

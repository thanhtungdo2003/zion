import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Vector3 } from 'three';
import { SoftTail, softShape } from './soft-tail';

/** The shader's bend, on the CPU: about the piece's root by its turn, scaled by the vertex weight. */
function bent(tail: SoftTail, g: BufferGeometry, i: number): Vector3 {
  const t = tail as unknown as { pivots: { value: Vector3[] }; turns: { value: Vector3[] } };
  const p = new Vector3().fromBufferAttribute(g.getAttribute('position'), i), piece = g.getAttribute('aSoftPiece').getX(i), w = g.getAttribute('aDangle').getX(i);
  const turn = t.turns.value[piece]!, pivot = t.pivots.value[piece]!, ang = turn.length() * w;
  if (ang < 1e-6) return p;
  const k = turn.clone().normalize(), r = p.clone().sub(pivot);
  return pivot.clone().add(r.clone().multiplyScalar(Math.cos(ang)).add(k.clone().cross(r).multiplyScalar(Math.sin(ang))).add(k.multiplyScalar(k.dot(r) * (1 - Math.cos(ang)))));
}

describe('soft tails', () => {
  it('a strap modelled sticking out sideways hangs down from where it is attached', () => {
    // A rigid block (x ≤ 0) and a strap along +X from it.
    const pts: number[] = [], idx: number[] = [];
    for (let i = 0; i <= 10; i++) pts.push(i * .02 - .04, 0, 0, i * .02 - .04, .01, 0);
    for (let i = 0; i < 10; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3)); g.setIndex(idx);
    const soft = Array.from({ length: 22 }, (_, i) => i).filter((i) => pts[i * 3]! > 0);
    const shape = softShape(g, soft)!;
    expect(shape.pieces).toHaveLength(1);
    const tail = new SoftTail(g, shape, .2), frame = new Group();
    for (let k = 0; k < 240; k++) { frame.updateMatrixWorld(); tail.update(frame, 1 / 60); }
    const tip = bent(tail, g, 20), root = shape.pieces[0]!.root;
    expect(tip.y).toBeLessThan(root.y - .1);
    expect(Math.abs(tip.x - root.x)).toBeLessThan(.12);
  });
});

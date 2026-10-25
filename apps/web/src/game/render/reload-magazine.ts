import { Box3, Matrix4, Quaternion, Vector3, type Object3D } from 'three';

/** The weapon's actual magazine, carried by the animated left hand during a reload. */
export class ReloadMagazine {
  private source: Object3D | null = null;
  private gun: Object3D | null = null;
  private held: Object3D | null = null;
  private readonly offset = new Matrix4();
  private attached = false;
  private sourceVisible = true;
  update(gun: Object3D | null, phase: number, hand: Matrix4 | null): void {
    const active = !!gun && !!hand && phase >= .14 && phase < .83;
    if (!active) { this.clear(); return; }
    if (!this.source || this.gun !== gun) {
      // Groups, not individual magazine faces; exclude accessories and prior carried copies.
      let source: Object3D | null = null;
      gun!.traverse(o => { if (!source && /^(magazine|mag)(?:__pivot)?$/i.test(o.name)) source = o; });
      if (!source) return;
      this.clear(); this.source = source; this.gun = gun;
    }
    const source = this.source!;
    if (!this.held) {
      source.updateWorldMatrix(true, true);
      this.sourceVisible = source.visible;
      this.held = source.clone(true); this.held.name = 'reload-magazine-in-hand'; this.held.visible = true;
      this.held.matrixAutoUpdate = false; gun!.parent!.add(this.held);
      const p = new Vector3(), q = new Quaternion(), s = new Vector3(); source.matrixWorld.decompose(p, q, s);
      const center = new Box3().setFromObject(source).getCenter(new Vector3());
      // Put the palm on the magazine body, keeping its original orientation relative to the hand.
      const palm = new Vector3().setFromMatrixPosition(hand!);
      p.add(palm.sub(center));
      const world = new Matrix4().compose(p, q, s);
      const handP = new Vector3(), handQ = new Quaternion(); hand!.decompose(handP, handQ, new Vector3());
      const unitHand = new Matrix4().compose(handP, handQ, new Vector3(1, 1, 1));
      this.offset.copy(unitHand).invert().multiply(world); this.attached = true;
    }
    source.visible = false;
    const p = new Vector3(), q = new Quaternion(); hand!.decompose(p, q, new Vector3());
    const world = new Matrix4().compose(p, q, new Vector3(1, 1, 1)).multiply(this.offset);
    // Seat the magazine smoothly at the end; it never teleports back from the hand.
    if (phase > .74) {
      const t = Math.min(1, (phase - .74) / .09), eased = t * t * (3 - 2 * t);
      const fromP = new Vector3(), fromQ = new Quaternion(), fromS = new Vector3(), toP = new Vector3(), toQ = new Quaternion(), toS = new Vector3();
      world.decompose(fromP, fromQ, fromS); source.matrixWorld.decompose(toP, toQ, toS);
      world.compose(fromP.lerp(toP, eased), fromQ.slerp(toQ, eased), fromS.lerp(toS, eased));
    }
    this.held!.matrix.copy(this.held!.parent!.matrixWorld).invert().multiply(world);
    this.held!.matrixWorldNeedsUpdate = true; this.held!.updateWorldMatrix(false, true);
  }
  clear(): void {
    if (this.source && this.attached) this.source.visible = this.sourceVisible;
    this.held?.removeFromParent(); this.held = null; this.source = null; this.gun = null; this.attached = false;
  }
}

/**
 * The fresh magazine taken from the pouch: a copy of the gun's magazine in the reloading hand,
 * from the pouch to the magazine well (the gun's own magazine is hidden meanwhile).
 */
export class FreshMagazine {
  private held: Object3D | null = null;
  private source: Object3D | null = null;
  private readonly centre = new Vector3();
  update(gun: Object3D | null, source: Object3D | null, show: boolean, hand: Matrix4 | null): void {
    if (!show || !gun?.parent || !source || !hand) { this.clear(); return; }
    if (!this.held || this.source !== source) {
      this.clear();
      this.source = source;
      this.held = source.clone(true); this.held.name = 'fresh-magazine-in-hand';
      this.held.traverse((o) => { o.visible = true; o.frustumCulled = false; });
      this.held.matrixAutoUpdate = false; gun.parent.add(this.held);
      // Its middle in the palm.
      this.held.updateMatrixWorld(true);
      const box = new Box3().setFromObject(this.held);
      this.centre.copy(box.getCenter(new Vector3())).applyMatrix4(new Matrix4().copy(this.held.matrixWorld).invert());
    }
    // Upright as it sits in the gun, its middle at the palm.
    source.parent?.updateWorldMatrix(true, false);
    const rest = new Matrix4().multiplyMatrices(source.parent?.matrixWorld ?? new Matrix4(), source.matrix);
    const p = new Vector3(), q = new Quaternion(), s = new Vector3(); rest.decompose(p, q, s);
    const palm = new Vector3().setFromMatrixPosition(hand);
    p.copy(palm).sub(this.centre.clone().multiply(s).applyQuaternion(q));
    const world = new Matrix4().compose(p, q, s);
    this.held.matrix.copy(this.held.parent!.matrixWorld).invert().multiply(world);
    this.held.matrixWorldNeedsUpdate = true; this.held.updateWorldMatrix(false, true);
  }
  clear(): void { this.held?.removeFromParent(); this.held = null; this.source = null; }
}

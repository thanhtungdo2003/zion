import { Group, Matrix4, Vector3, type Camera, type Object3D } from 'three';
import type { Appearance } from '@zion/shared';
import { HumanBody, MODEL_EYE_Y, type Grasp, type HandPreset, type HumanAssets, type MocapLayer, type Side } from './human-rig';
import { rifleReloadLayer } from './recorded-reload';

/** What one first-person hand does this frame: hold a handle, reach to a point, or nothing. */
export type FpHand = { grasp: Grasp } | { palm: Vector3; preset: HandPreset } | { rifle: FpRifle } | null;

/** A long gun held as recorded: the display model, grip at its origin, bore +X, top +Y. */
export interface FpRifle { model: Object3D; key: string; support: Vector3 | null; gripRadius?: number; supportRadius?: number }

const SIDES = ['L', 'R'] as const;

/**
 * The survivor's own forearms and hands in the first-person view, skinned like the third-person
 * body: anchored at the shoulders just below and behind the camera, elbows bent by IK, fingers
 * closed round the gun's grip and handguard, a blade's handle or a ledge, or relaxed at the
 * bottom of the view when the hands are empty. Posed just before rendering, after the weapon's own
 * pose (sway, recoil, aim), so the hands never lag behind the gun.
 */
export class FirstPersonHands {
  readonly holder = new Group();
  private readonly body: HumanBody;
  private pending: (() => Record<Side, FpHand>) | null = null;
  private afterPose: (() => void) | null = null;
  private readonly shoulders: Record<Side, Vector3>;
  private readonly reach: number;
  private reload: MocapLayer | null = null;

  constructor(assets: HumanAssets, camera: Camera) {
    this.body = new HumanBody(assets, { armsOnly: true, shadows: false });
    this.holder.name = 'first-person-hands';
    this.holder.add(this.body.group);
    // Camera at the eyes (in the survivor's model space, facing −Z).
    const EYE = new Vector3(0, MODEL_EYE_Y, -.054).multiplyScalar(this.body.group.scale.x);
    this.body.group.position.copy(EYE).negate();
    this.holder.visible = false;
    camera.add(this.holder);
    const shoulder = (s: Side) => {
      const p = assets.restP[assets.index.get(`upper_arm_${s}`)!]!;
      return new Vector3(-p.x, p.y, -p.z).multiplyScalar(this.body.group.scale.x).sub(EYE);
    };
    this.shoulders = { L: shoulder('L'), R: shoulder('R') };
    const at = (n: string) => assets.restP[assets.index.get(n)!]!;
    this.reach = (at('upper_arm_R').distanceTo(at('forearm_R')) + at('forearm_R').distanceTo(at('hand_R')) + assets.hands.R.palm.length()) * this.body.group.scale.x;
    // Posed after the camera's other children (the weapon) have their world matrices.
    const update = this.holder.updateMatrixWorld.bind(this.holder);
    this.holder.updateMatrixWorld = (force?: boolean) => {
      update(force);
      if (this.pending && this.holder.visible) { const p = this.pending; this.pending = null; this.pose(p()); this.afterPose?.(); update(true); }
    };
  }

  setLook(a: Appearance): void { this.body.setAppearance(a); }

  get visible(): boolean { return this.holder.visible; }
  set visible(v: boolean) { this.holder.visible = v; }

  /** Hands for the next rendered frame (evaluated then, when the gun's pose is final). */
  request(hands: () => Record<Side, FpHand>, afterPose?: () => void): void { this.pending = hands; this.afterPose = afterPose ?? null; }

  palmMatrix(side: Side) { return this.body.palmMatrix(side); }

  /** The source recording, synchronized to the same gameplay duration as the body. */
  setReload(elapsed: number, duration: number): boolean {
    const clip = this.body.assets.clips.get('rifle_reload');
    this.reload = clip && elapsed >= 0 ? rifleReloadLayer(elapsed, duration, clip.duration) : null;
    return !!this.reload;
  }

  get recordedReload(): boolean { return !!this.reload; }

  /** Use the survivor's supplied aiming wrists in the display's +X barrel / +Y up frame. */
  rifleGripBasis(side: Side): { axis: Vector3; approach: Vector3 } {
    return this.body.rifleGripBasis(side, new Vector3(1, 0, 0), new Vector3(0, 1, 0));
  }

  private clock = 0;
  private lastPose = 0;

  /**
   * Both arms keep the recorded rifle aiming shape (elbow planes, wrists, fingers) while the
   * shoulders stay anchored below and behind the camera, so the arm mesh's cut edge never
   * enters the view; each hand is placed on the gun by two-bone IK (grip and handguard).
   */
  private poseRifle(r: FpRifle): void {
    const body = this.body;
    const now = performance.now() / 1000;
    this.clock += Math.min(.1, Math.max(0, now - this.lastPose)); this.lastPose = now;
    body.poseMocap({ clip: 'rifle_aim_idle', time: this.clock, weight: 1, arms: true, hips: false }, 0);
    r.model.updateWorldMatrix(true, false);
    const scale = new Vector3().setFromMatrixScale(r.model.matrixWorld).x;
    const fit = body.rifleFit({ key: r.key, barrel: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), grip: new Vector3(), scale, trigger: 'R', twoHanded: !!r.support, gripRadius: r.gripRadius });
    const targets: Record<Side, Matrix4 | null> = {
      R: r.model.matrixWorld.clone().multiply(fit.inHand.clone().invert()),
      L: r.support ? body.supportTarget('L', r.model.matrixWorld, fit, r.support, r.supportRadius ?? .021) : null,
    };
    // Cradled from below: the support hand sits lower, the guard resting on the palm and the
    // lightly bent fingers only reaching up its side (see cradle below).
    if (targets.L) {
      const down = new Vector3(0, -1, 0).transformDirection(r.model.matrixWorld).multiplyScalar(.022 * scale);
      targets.L.premultiply(new Matrix4().makeTranslation(down.x, down.y, down.z));
    }
    for (const s of SIDES) {
      const target = targets[s];
      if (!target) continue;
      const wrist = new Vector3().setFromMatrixPosition(target);
      // Far reaches bring the shoulder forward (the torso turns), staying low and inside.
      const shoulder = this.shoulders[s].clone();
      const far = this.holder.worldToLocal(wrist.clone()).distanceTo(shoulder) - this.reach * .9;
      if (far > 0) shoulder.add(new Vector3(s === 'L' ? .25 : -.25, -.35, -1).normalize().multiplyScalar(Math.min(.32, far * 1.1)));
      body.placeShoulder(s, this.holder.localToWorld(shoulder));
      body.placeHand(s, target, 1, s === 'R' ? Math.PI : undefined);
      // The support hand holds the handguard from below, not wrapped round it.
      if (s === 'L') body.cradle('L');
    }
  }

  private pose(hands: Record<Side, FpHand>): void {
    const body = this.body;
    const rifle = hands.R && 'rifle' in hands.R ? hands.R.rifle : null;
    if (rifle) {
      this.poseRifle(rifle);
      const L = hands.L;
      if (L && !('rifle' in L)) {
        const pole = this.holder.localToWorld(new Vector3(-.6, -1, .25)).sub(this.holder.getWorldPosition(new Vector3()));
        if ('grasp' in L) body.holdWith('L', L.grasp, pole, true, true);
        else body.reachWith('L', L.palm, pole, L.preset);
      }
      if (this.reload && !L) body.reloadSupport(this.reload);
      return;
    }
    body.restPose();
    for (const s of SIDES) {
      const hand = hands[s];
      if (!hand || 'rifle' in hand) continue;
      const target = 'grasp' in hand ? hand.grasp.center : hand.palm;
      // The shoulder comes forward (the torso turns, the shoulder blade slides) for far reaches,
      // staying low and inside, out of view.
      const shoulder = this.shoulders[s].clone();
      const far = this.holder.worldToLocal(target.clone()).distanceTo(shoulder) - this.reach * .94;
      if (far > 0) { const k = Math.min(.32, far * 1.1); shoulder.add(new Vector3(s === 'L' ? .25 : -.25, -.35, -1).normalize().multiplyScalar(k)); }
      const anchor = this.holder.localToWorld(shoulder);
      body.placeShoulder(s, anchor);
      // Elbows down and out, as when holding a gun up.
      const pole = this.holder.localToWorld(new Vector3(s === 'L' ? -.6 : .6, -1, .25)).sub(this.holder.getWorldPosition(new Vector3()));
      if ('grasp' in hand) body.holdWith(s, hand.grasp, pole, true, s === 'L');
      else body.reachWith(s, hand.palm, pole, hand.preset);
    }
    // An unused hand stays out of view (the mesh is drawn for both arms).
    for (const s of SIDES) if (!hands[s]) body.reachWith(s, this.holder.localToWorld(new Vector3(s === 'L' ? -.3 : .3, -.9, .2)), new Vector3(0, -1, 0), 'relaxed');
    if (this.reload && hands.R && hands.L) body.reloadSupport(this.reload);
  }

  dispose(): void {
    this.holder.removeFromParent();
    this.body.dispose();
  }
}

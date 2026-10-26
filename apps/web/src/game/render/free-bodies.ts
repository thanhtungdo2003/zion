import { Group, Mesh, Quaternion, type Scene } from 'three';
import type { BodiesMessage } from '@zion/shared';
import type { AssetLibrary } from './asset-library';

/**
 * Playback of the server's rigid bodies (knocked props). The server simulates them; the client
 * only interpolates the poses it receives, a little in the past so there is always a pose on
 * either side. Sleeping bodies hold their last pose and cost nothing per frame.
 */
export const BODY_DELAY_MS = 110;
const MAX_FRAMES = 8;

export interface BodyFrame { at: number; x: number; y: number; z: number; q: Quaternion; asleep: boolean }

/** Pose history of one body; samples by server time. */
export class BodyTimeline {
  readonly frames: BodyFrame[] = [];

  push(frame: BodyFrame): void {
    const last = this.frames.at(-1);
    if (last && frame.at < last.at) return;
    if (last && frame.at === last.at) this.frames.pop();
    this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  /** Interpolated pose at server time `t`; holds the ends (no extrapolation: bodies never overshoot a wall). */
  sample(t: number, out: { x: number; y: number; z: number; q: Quaternion }): void {
    const f = this.frames;
    let a = f[0]!, b = a;
    for (const frame of f) { if (frame.at <= t) a = frame; if (frame.at >= t) { b = frame; break; } b = frame; }
    const k = b.at > a.at ? Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at))) : 1;
    out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k;
    out.q.slerpQuaternions(a.q, b.q, k);
  }

  /** Nothing left to animate: the latest pose is asleep and playback has reached it. */
  settled(t: number): boolean {
    const last = this.frames.at(-1);
    return !!last && last.asleep && t >= last.at;
  }
}

interface View { asset: number; scale: number; timeline: BodyTimeline; root: Group; built: boolean; settledAt: number }

export class FreeBodyViews {
  private readonly views = new Map<number, View>();
  private readonly pose = { x: 0, y: 0, z: 0, q: new Quaternion() };

  constructor(private readonly scene: Scene, private readonly library: AssetLibrary) {}

  get count(): number { return this.views.size; }

  apply(m: BodiesMessage): void {
    if (m.full) for (const id of [...this.views.keys()]) if (!m.list.some((r) => r[0] === id)) this.drop(id);
    for (const id of m.gone ?? []) this.drop(id);
    for (const [id, asset, scale, x, y, z, qx, qy, qz, qw, asleep] of m.list) {
      let v = this.views.get(id);
      if (!v) {
        const root = new Group();
        root.scale.setScalar(scale);
        this.scene.add(root);
        this.views.set(id, (v = { asset, scale, timeline: new BodyTimeline(), root, built: false, settledAt: -1 }));
      }
      v.settledAt = -1;
      v.timeline.push({ at: m.at, x, y, z, q: new Quaternion(qx, qy, qz, qw), asleep: asleep === 1 });
    }
  }

  /** Places every body at server time `serverNow - BODY_DELAY_MS`. */
  update(serverNow: number): void {
    const t = serverNow - BODY_DELAY_MS;
    for (const v of this.views.values()) {
      if (!v.built) this.build(v);
      if (v.settledAt >= 0) continue;
      v.timeline.sample(t, this.pose);
      v.root.position.set(this.pose.x, this.pose.y, this.pose.z);
      v.root.quaternion.copy(this.pose.q);
      if (v.timeline.settled(t)) v.settledAt = t;
    }
  }

  /** Current displayed bodies (collider debug view). */
  *bodies(): Iterable<{ id: number; asset: number; root: Group }> {
    for (const [id, v] of this.views) yield { id, asset: v.asset, root: v.root };
  }

  private build(v: View): void {
    const visual = this.library.get(v.asset);
    if (!visual) { void this.library.load(v.asset)?.catch(() => undefined); return; }
    for (const part of visual.parts) { const mesh = new Mesh(part.geometry, part.material); mesh.castShadow = true; mesh.receiveShadow = true; v.root.add(mesh); }
    v.built = true;
  }

  private drop(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    // Geometry and materials belong to the asset library; only the wrappers go.
    this.scene.remove(v.root);
    this.views.delete(id);
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.drop(id);
  }
}

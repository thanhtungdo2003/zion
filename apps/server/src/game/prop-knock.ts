import { CHUNK_SIZE, propKey, propTransform, type PropInstance, type ServerJsonMessage } from '@zion/shared';
import type { AssetRegistry } from '@zion/assets';
import type { WorldService } from '../world/world-service';
import type { PhysicsChunkManager } from './physics-manager';
import { DYNAMIC_BODY_TAG, proxyFromColliders, yawPose, type MaterialId, type ProxyPart } from '@zion/physics';
import type { FreeBodies } from './free-bodies';

/**
 * Light props that give way: road signs, barriers and cones, barrels, buckets, boards, fences,
 * site crates and small trees. A vehicle driving into one, a bullet or a blast knocks it loose
 * (small trees fall over instead; it takes a few bullets to bring one down). It leaves the static
 * collision world at once and becomes a server rigid body (FreeBodies) with its real mass and
 * collision shape: the car, the round or the blast then moves it by physics, players push it about
 * and every client plays back its poses. Past the body budget it falls back to cosmetic debris.
 * A couple of minutes later it stands again where it was, once nobody is in the way.
 */
export const RESTORE_MS = 150_000;
const TREE_SHOTS = 4;
/** Knockable by kind: 'light' flies off, 'tree' falls over. */
export type KnockKind = 'light' | 'tree';

/**
 * Physical make-up of each light prop: surface material and mass (kg, typical real objects; hollow
 * things like drums and cones are far lighter than their volume). By default the physics proxy is
 * the asset's own colliders; `extra` adds parts they leave out (a sign's plate: the pole alone is
 * what a walker bumps into) and `proxy` replaces them where the true shape matters to the motion
 * (round drums and cans roll, cones have no static collider at all).
 */
export interface PropPhysics { material: MaterialId; mass: number; extra?: ProxyPart[]; proxy?: ProxyPart[] }
const P = (material: MaterialId, mass: number, extra?: ProxyPart[]): PropPhysics => ({ material, mass, extra });
const cylinder = (material: MaterialId, mass: number, r: number, height: number): PropPhysics =>
  ({ material, mass, proxy: [{ type: 'cylinder', cx: 0, cy: height / 2, cz: 0, r, hh: height / 2 }] });
export const PROP_PHYSICS = new Map<number, PropPhysics>([
  // camp: barrel, branch, can, board, bucket, bottle, wooden fence
  [2003, cylinder('sheetMetal', 22, .42, .94)], [2005, P('wood', 3)], [2010, cylinder('sheetMetal', .3, .065, .2)], [2012, P('wood', 6)], [2013, P('sheetMetal', 1.5)],
  [2027, cylinder('glass', .5, .065, .32)], [2028, P('wood', 18)],
  // building site: barrel, crates
  [2660, cylinder('sheetMetal', 22, .3, .9)], [2667, P('wood', 14)], [2668, P('wood', 14)], [2670, P('wood', 14)],
  // barriers (plastic, not water-filled), posts and cones
  [2680, P('plastic', 9)], [2681, P('plastic', 8)], [2682, P('plastic', 12)], [2683, P('plastic', 6)], [2684, P('plastic', 14)],
  [2685, P('plastic', 4)], [2686, P('plastic', 4)], [2687, cylinder('rubber', 2.5, .17, .69)], [2688, cylinder('rubber', 3, .16, 1.6)], [2689, P('plastic', 9)], [2690, P('plastic', 9)],
]);
const SIGNS = { from: 2720, to: 2729 };
const SIGN_PHYSICS = P('sheetMetal', 9, [{ type: 'box', cx: 0, cy: 2.55, cz: 0, hx: .33, hy: .33, hz: .02, yaw: 0 }]);
export const propPhysics = (asset: number): PropPhysics | undefined => PROP_PHYSICS.get(asset) ?? (asset >= SIGNS.from && asset <= SIGNS.to ? SIGN_PHYSICS : undefined);

export interface KnockDeps {
  world: WorldService;
  registry: AssetRegistry;
  physics: PhysicsChunkManager;
  /** Server rigid bodies for knocked props (absent: cosmetic debris only). */
  bodies?: FreeBodies | null;
  broadcastAt(x: number, z: number, msg: ServerJsonMessage): void;
  broadcast(msg: ServerJsonMessage): void;
  /** Someone stands within `r` m of (x, z): wait before putting a prop back. */
  occupied(x: number, z: number, r: number): boolean;
}

interface Knocked { cx: number; cz: number; x: number; z: number; restoreAt: number; body?: number }

export class PropKnock {
  private readonly knocked = new Map<string, Knocked>();
  private readonly shots = new Map<string, { n: number; at: number }>();
  private readonly kinds = new Map<number, KnockKind | null>();

  constructor(private readonly deps: KnockDeps) {
    const before = deps.physics.propFilter;
    deps.physics.propFilter = (cx, cz, p) => (!before || before(cx, cz, p)) && !this.knocked.has(propKey(cx, cz, p.lx, p.lz));
  }

  kind(asset: number): KnockKind | null {
    if (this.kinds.has(asset)) return this.kinds.get(asset)!;
    const def = this.deps.registry.byNumericId(asset);
    let k: KnockKind | null = null;
    if (propPhysics(asset)) k = 'light';
    else if (def?.category === 'tree' && def.colliders.length && def.bounds.height <= 7) k = 'tree';
    this.kinds.set(asset, k);
    return k;
  }

  /** Every knockable prop standing within `r` m (horizontally) of (x, z). */
  private near(x: number, z: number, r: number): Array<{ key: string; cx: number; cz: number; prop: PropInstance; kind: KnockKind; x: number; y: number; z: number; rotY: number; scale: number; d: number; radius: number; height: number }> {
    const out: ReturnType<PropKnock['near']> = [];
    const c0x = Math.floor((x - r - 4) / CHUNK_SIZE), c1x = Math.floor((x + r + 4) / CHUNK_SIZE);
    const c0z = Math.floor((z - r - 4) / CHUNK_SIZE), c1z = Math.floor((z + r + 4) / CHUNK_SIZE);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const chunk = this.deps.world.peek(cx, cz, 0)?.data;
      if (!chunk) continue;
      for (const prop of chunk.props) {
        const kind = this.kind(prop.asset);
        if (!kind) continue;
        const key = propKey(cx, cz, prop.lx, prop.lz);
        if (this.knocked.has(key)) continue;
        const t = propTransform(chunk, prop), def = this.deps.registry.byNumericId(prop.asset)!;
        const radius = def.bounds.radius * t.scale, d = Math.hypot(t.x - x, t.z - z);
        if (d > r + radius) continue;
        out.push({ key, cx, cz, prop, kind, x: t.x, y: t.y, z: t.z, rotY: t.rotY, scale: t.scale, d, radius, height: def.bounds.height * t.scale });
      }
    }
    return out;
  }

  /**
   * Takes the prop out of the static world. A light prop becomes a rigid body at rest where it
   * stood (the caller's impulse or the vehicle's contact moves it); `vx, vy, vz` is only the
   * cosmetic throw for trees and for props past the body budget. Returns the body id, if any.
   */
  private knock(p: ReturnType<PropKnock['near']>[number], vx: number, vy: number, vz: number, now: number): number | undefined {
    this.shots.delete(p.key);
    const physics = p.kind === 'light' ? propPhysics(p.prop.asset) : undefined, def = this.deps.registry.byNumericId(p.prop.asset);
    let body: number | undefined;
    if (physics && def && this.deps.bodies) {
      const parts = physics.proxy ? physics.proxy.map((e) => scalePart(e, p.scale))
        : [...proxyFromColliders(def.colliders, p.scale), ...(physics.extra ?? []).map((e) => scalePart(e, p.scale))];
      // Lifted a couple of centimetres: on a slope the foot would otherwise start inside the ground.
      body = this.deps.bodies.spawn(p.prop.asset, p.scale, { parts, mass: physics.mass * p.scale ** 3, material: physics.material }, yawPose(p.x, p.y + .02, p.z, p.rotY)) ?? undefined;
    }
    this.knocked.set(p.key, { cx: p.cx, cz: p.cz, x: p.x, z: p.z, restoreAt: now + RESTORE_MS, body });
    this.deps.physics.reload(p.cx, p.cz);
    const r = (v: number) => Math.round(v * 100) / 100;
    this.deps.broadcastAt(p.x, p.z, { t: 'knock', key: p.key, asset: p.prop.asset, x: r(p.x), y: r(p.y), z: r(p.z), rotY: r(p.rotY), scale: r(p.scale), vx: r(vx), vy: r(vy), vz: r(vz), tree: p.kind === 'tree', ...(body !== undefined ? { body } : {}) });
    return body;
  }

  /**
   * Vehicles: whatever light thing stands just ahead of a moving one is flung off along its
   * path, faster the harder it is hit; small trees go over. Checked a little ahead, so the
   * prop is gone before the body meets its collider.
   */
  vehicle(x: number, z: number, vx: number, vz: number, halfLength: number, now: number): void {
    const speed = Math.hypot(vx, vz);
    if (speed < 2.5) return;
    const ax = x + vx * .12, az = z + vz * .12;
    for (const p of this.near(ax, az, halfLength + .6)) {
      const ox = p.x - x, oz = p.z - z;
      if ((ox * vx + oz * vz) / (Math.hypot(ox, oz) || 1) < speed * .2) continue;
      // A light prop becomes a body standing in the vehicle's path: the chassis meets it in Jolt
      // and shoves it by mass and closing speed. This velocity is only the cosmetic fallback.
      const push = p.kind === 'tree' ? Math.min(3, speed * .25) : speed * 1.15;
      const n = Math.hypot(ox, oz) || 1, side = .35;
      this.knock(p, vx / speed * push + ox / n * push * side, p.kind === 'tree' ? 0 : 1.5 + speed * .18, vz / speed * push + oz / n * push * side, now);
    }
  }

  /** A round stopped on a collider of `asset` at (x, y, z), flying along (dx, dy, dz). */
  bullet(asset: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, damage: number, now: number): void {
    // Already loose: the round's momentum acts on the body where it struck.
    if (this.deps.bodies?.shot(asset, x, y, z, dx, dy, dz, damage)) return;
    const kind = this.kind(asset);
    if (!kind) return;
    const p = this.near(x, z, 1.2).filter((c) => c.prop.asset === asset).sort((a, b) => a.d - b.d)[0];
    if (!p || y < p.y - .5 || y > p.y + p.height + .5) return;
    if (kind === 'tree') {
      const s = this.shots.get(p.key), n = (s && now - s.at < 30_000 ? s.n : 0) + Math.max(1, Math.round(damage / 40));
      if (n < TREE_SHOTS) { this.shots.set(p.key, { n, at: now }); return; }
      this.knock(p, dx * 2, 0, dz * 2, now);
      return;
    }
    const push = Math.min(9, 2 + damage * .08);
    const body = this.knock(p, dx * push, Math.max(1.2, dy * push + 1.5), dz * push, now);
    if (body !== undefined) this.deps.bodies!.shot(DYNAMIC_BODY_TAG + body, x, y, z, dx, dy, dz, damage);
  }

  /** A blast: everything light within reach flies outward, small trees close in go over. */
  blast(x: number, y: number, z: number, radius: number, now: number): void {
    const reach = radius * 1.4;
    for (const p of this.near(x, z, reach)) {
      if (Math.abs(p.y - y) > reach) continue;
      const k = 1 - Math.min(1, p.d / reach);
      if (p.kind === 'tree' && k < .45) continue;
      const n = p.d || 1, ox = (p.x - x) / n, oz = (p.z - z) / n, push = 3 + 12 * k;
      this.knock(p, ox * push, p.kind === 'tree' ? 0 : 3 + 7 * k, oz * push, now);
    }
    // Loose bodies (including the ones just knocked) take the blast as an impulse on their mass.
    this.deps.bodies?.blast(x, y, z, radius);
  }

  /** Props whose time is up stand again (unless someone stands in the way). */
  step(now: number): void {
    let changed = false;
    for (const [key, k] of this.knocked) {
      if (now < k.restoreAt) continue;
      if (this.deps.occupied(k.x, k.z, 2)) { k.restoreAt = now + 10_000; continue; }
      this.knocked.delete(key);
      if (k.body !== undefined) this.deps.bodies?.remove(k.body);
      this.deps.physics.reload(k.cx, k.cz);
      changed = true;
    }
    for (const [key, s] of this.shots) if (now - s.at > 30_000) this.shots.delete(key);
    if (changed) this.deps.broadcast(this.message());
  }

  /** Everything currently knocked down (joining players, and after props stand again). */
  message(): ServerJsonMessage {
    return { t: 'knocked', keys: [...this.knocked.keys()] };
  }
}

function scalePart(p: ProxyPart, k: number): ProxyPart {
  if (p.type === 'box') return { ...p, cx: p.cx * k, cy: p.cy * k, cz: p.cz * k, hx: p.hx * k, hy: p.hy * k, hz: p.hz * k };
  if (p.type === 'sphere') return { ...p, cx: p.cx * k, cy: p.cy * k, cz: p.cz * k, r: p.r * k };
  if (p.type === 'cylinder') return { ...p, cx: p.cx * k, cy: p.cy * k, cz: p.cz * k, r: p.r * k, hh: p.hh * k };
  return { ...p, ax: p.ax * k, ay: p.ay * k, az: p.az * k, bx: p.bx * k, by: p.by * k, bz: p.bz * k, r: p.r * k };
}

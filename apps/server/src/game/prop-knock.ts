import { CHUNK_SIZE, propKey, propTransform, type PropInstance, type ServerJsonMessage } from '@zion/shared';
import type { AssetRegistry } from '@zion/assets';
import type { WorldService } from '../world/world-service';
import type { PhysicsChunkManager } from './physics-manager';

/**
 * Light props that give way: road signs, barriers and cones, barrels, buckets, boards, fences,
 * site crates and small trees. A vehicle driving into one, a bullet or a blast knocks it away
 * (small trees fall over instead; it takes a few bullets to bring one down). It leaves the
 * collision world at once and every client throws its model as debris; a couple of minutes later
 * it stands again where it was, once nobody is in the way.
 */
export const RESTORE_MS = 150_000;
const TREE_SHOTS = 4;
/** Knockable by kind: 'light' flies off, 'tree' falls over. */
export type KnockKind = 'light' | 'tree';

const LIGHT_ASSETS = new Set<number>([
  2003, 2005, 2010, 2012, 2013, 2027, 2028, // camp: barrel, branch, can, board, bucket, bottle, wooden fence
  2660, 2667, 2668, 2670, // building site: barrel, crates
  2680, 2681, 2682, 2683, 2684, 2685, 2686, 2687, 2688, 2689, 2690, // barriers, posts, cones
]);
const SIGNS = { from: 2720, to: 2729 };

export interface KnockDeps {
  world: WorldService;
  registry: AssetRegistry;
  physics: PhysicsChunkManager;
  broadcastAt(x: number, z: number, msg: ServerJsonMessage): void;
  broadcast(msg: ServerJsonMessage): void;
  /** Someone stands within `r` m of (x, z): wait before putting a prop back. */
  occupied(x: number, z: number, r: number): boolean;
}

interface Knocked { cx: number; cz: number; x: number; z: number; restoreAt: number }

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
    if (LIGHT_ASSETS.has(asset) || (asset >= SIGNS.from && asset <= SIGNS.to)) k = 'light';
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

  private knock(p: ReturnType<PropKnock['near']>[number], vx: number, vy: number, vz: number, now: number): void {
    this.knocked.set(p.key, { cx: p.cx, cz: p.cz, x: p.x, z: p.z, restoreAt: now + RESTORE_MS });
    this.shots.delete(p.key);
    this.deps.physics.reload(p.cx, p.cz);
    const r = (v: number) => Math.round(v * 100) / 100;
    this.deps.broadcastAt(p.x, p.z, { t: 'knock', key: p.key, asset: p.prop.asset, x: r(p.x), y: r(p.y), z: r(p.z), rotY: r(p.rotY), scale: r(p.scale), vx: r(vx), vy: r(vy), vz: r(vz), tree: p.kind === 'tree' });
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
      const push = p.kind === 'tree' ? Math.min(3, speed * .25) : speed * 1.15;
      const n = Math.hypot(ox, oz) || 1, side = .35;
      this.knock(p, vx / speed * push + ox / n * push * side, p.kind === 'tree' ? 0 : 1.5 + speed * .18, vz / speed * push + oz / n * push * side, now);
    }
  }

  /** A round stopped on a collider of `asset` at (x, y, z), flying along (dx, dy, dz). */
  bullet(asset: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, damage: number, now: number): void {
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
    this.knock(p, dx * push, Math.max(1.2, dy * push + 1.5), dz * push, now);
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
  }

  /** Props whose time is up stand again (unless someone stands in the way). */
  step(now: number): void {
    let changed = false;
    for (const [key, k] of this.knocked) {
      if (now < k.restoreAt) continue;
      if (this.deps.occupied(k.x, k.z, 2)) { k.restoreAt = now + 10_000; continue; }
      this.knocked.delete(key);
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

import { Group, Mesh, Vector3, type Scene } from 'three';
import {
  BLUEPRINT_BY_ITEM,
  CAMP_BUILD_EXCLUSION,
  CRAFTS,
  DOOR_REACH,
  GATHER_REACH,
  ORE_NAME,
  ROCK_ASSETS,
  TREE_ASSETS,
  chunkKey,
  placementPoint,
  propKey,
  propTransform,
  rockOre,
  structureOwner,
  type BlueprintDef,
  type ChunkData,
  type ServerJsonMessage,
  type TreesMessage,
  type WorldInfo,
} from '@zion/shared';
import { checkPlacement, structureColliders } from '@zion/physics';
import type { AssetLibrary } from './render/asset-library';
import { FelledTrees, PlacementHologram, StructureRenderer, SupplyRenderer } from './render/building';
import { FreeBodyViews } from './render/free-bodies';
import type { DebrisSystem } from './render/debris';
import { ParticleFX, type ParticleSystem } from './render/particles';
import type { ChunkStore } from './world/chunk-store';
import type { HudStore } from './hud-store';
import type { InventoryStore } from './inventory/inventory';
import type { GameConnection } from './net/connection';
import type { Msg } from '@/lib/i18n';

/** What the building controller needs from the engine. */
export interface BuildingHost {
  scene: Scene;
  library: AssetLibrary;
  store(): ChunkStore | null;
  conn: GameConnection;
  hud: HudStore;
  inventory: InventoryStore;
  debris(): DebrisSystem | null;
  particles(): ParticleSystem | null;
  play(name: 'arrowHitHard' | 'bulletHit' | 'knockdown' | 'equip' | 'tradeSuccess', at?: { x: number; y: number; z: number }, volume?: number): void;
  /** The local player (null while dead / loading). */
  local(): { x: number; y: number; z: number; yaw: number; grounded: boolean } | null;
  /** Our player name (structures carry their owner's name). */
  username(): string;
  toast(msg: Msg): void;
  equippedItemId(): string | null;
  /** Keeps a looping engine sound at a point (null stops it). */
  planeSound(key: object, at: { x: number; y: number; z: number } | null): void;
  /** Estimated server time (ms): server rigid bodies play back on its timeline. */
  serverNow(): number;
}

/** A thing to use within reach (merged into the engine's interaction targets). */
export interface BuildTarget { kind: 'trunk' | 'door' | 'hint'; x: number; y: number; z: number; radius: number; label: Msg; run: () => void }

const raw = (text: string): Msg => ({ key: 'raw', vars: { text } });

/**
 * Survival base building on the client: hides felled trees, animates their fall and shows the
 * trunks, draws structures (and gives them colliders for prediction), the placement hologram,
 * supply planes and drops, and turns it all into interaction targets and server requests.
 */
export class BuildingController {
  private readonly trees: FelledTrees;
  private readonly structures: StructureRenderer;
  private readonly hologram: PlacementHologram;
  private readonly supply: SupplyRenderer;
  /** Server rigid bodies (knocked props) played back from their poses. */
  readonly bodies: FreeBodyViews;
  private removed = new Set<string>();
  /** Light props knocked away (vehicles, bullets, blasts) until they stand again. */
  private knocked = new Set<string>();
  private spent = new Set<string>();
  /** Chunks as the server sent them (props unfiltered), to restore trees that grew back. */
  private readonly rawChunks = new Map<number, ChunkData>();
  private world: WorldInfo | null = null;
  private plan: { uid: number; def: BlueprintDef; rot: number; yaw: number; ok: boolean; x: number; y: number; z: number; reason: string | null } | null = null;
  private seenTrees = false;

  constructor(private readonly host: BuildingHost) {
    this.trees = new FelledTrees(host.scene, host.library);
    this.structures = new StructureRenderer(host.scene, host.debris, host.library);
    this.hologram = new PlacementHologram(host.scene);
    this.supply = new SupplyRenderer(host.scene, host.library);
    this.bodies = new FreeBodyViews(host.scene, host.library);
  }

  setWorld(world: WorldInfo): void {
    this.world = world;
    this.supply.ground = (x, z) => { const h = this.host.store()?.collision.terrainHeight(x, z); return h !== undefined && Number.isFinite(h) ? h : 0; };
    this.publishSupply();
  }

  get planning(): boolean { return !!this.plan; }
  /** The blueprint item held up while placing (first-person hands show it). */
  get planItem(): string | null { return this.plan?.def.item ?? null; }

  /* ---------------------------------------- chunks ------------------------------------- */

  /** A chunk from the server: remember it, and hand on a copy without the felled trees. */
  filterChunk(c: ChunkData): ChunkData {
    this.rawChunks.set(chunkKey(c.cx, c.cz), c);
    if (!this.removed.size && !this.knocked.size) return c;
    const props = c.props.filter((p) => { const k = propKey(c.cx, c.cz, p.lx, p.lz); return !this.removed.has(k) && !this.knocked.has(k); });
    return props.length === c.props.length ? c : { ...c, props };
  }

  forget(c: ChunkData): void { this.rawChunks.delete(chunkKey(c.cx, c.cz)); }

  private applyTrees(msg: TreesMessage): void {
    const next = new Set(msg.removed);
    const changed = new Set<string>();
    for (const k of next) if (!this.removed.has(k)) changed.add(k);
    for (const k of this.removed) if (!next.has(k)) changed.add(k);
    // A tree we saw standing comes down now: drop sound at its foot.
    for (const t of msg.trunks) if (this.seenTrees && changed.has(t.key) && next.has(t.key)) this.host.play('knockdown', t, 1);
    this.removed = next;
    this.spent = new Set(msg.spent);
    this.trees.apply(msg, this.seenTrees);
    this.seenTrees = true;
    if (!changed.size) return;
    const chunks = new Set([...changed].map((k) => { const [cx, cz] = k.split(':').map(Number); return `${cx}:${cz}`; }));
    const store = this.host.store();
    if (!store) return;
    for (const [, c] of this.rawChunks) {
      if (!chunks.has(`${c.cx}:${c.cz}`)) continue;
      const shown = store.get(c.cx, c.cz);
      if (shown && shown.lod === c.lod) store.set(this.filterChunk(c));
    }
  }

  /** Re-shows the chunks holding these prop keys with the current filters. */
  private refilter(keys: Iterable<string>): void {
    const chunks = new Set([...keys].map((k) => { const [cx, cz] = k.split(':'); return `${cx}:${cz}`; }));
    const store = this.host.store();
    if (!store || !chunks.size) return;
    for (const [, c] of this.rawChunks) {
      if (!chunks.has(`${c.cx}:${c.cz}`)) continue;
      const shown = store.get(c.cx, c.cz);
      if (shown && shown.lod === c.lod) store.set(this.filterChunk(c));
    }
  }

  /**
   * A prop knocked away: hide it. A server rigid body takes its place (poses follow in 'bodies');
   * otherwise its model is thrown as debris (a small tree topples over its foot).
   */
  private knockAway(m: Extract<ServerJsonMessage, { t: 'knock' }>): void {
    this.knocked.add(m.key);
    this.refilter([m.key]);
    const visual = this.host.library.get(m.asset), debris = this.host.debris();
    this.host.play(m.tree ? 'knockdown' : 'arrowHitHard', m, m.tree ? 1 : .7);
    if (m.body !== undefined) {
      // Shown at once where it stood, until its first simulated pose arrives.
      this.bodies.apply({ t: 'bodies', at: this.host.serverNow() - 1000, list: [[m.body, m.asset, m.scale, m.x, m.y, m.z, 0, Math.sin(m.rotY / 2), 0, Math.cos(m.rotY / 2), 0]] });
      return;
    }
    if (!visual || !debris) return;
    const obj = new Group();
    for (const part of visual.parts) { const mesh = new Mesh(part.geometry, part.material); mesh.castShadow = true; obj.add(mesh); }
    obj.position.set(m.x, m.y, m.z);
    obj.rotation.y = m.rotY;
    obj.scale.setScalar(m.scale);
    obj.updateMatrixWorld(true);
    const vel = new Vector3(m.vx, m.vy, m.vz), h = Math.hypot(m.vx, m.vz) || 1;
    // Tumbling about the axis across the push; a tree only tips (its foot stays put).
    const spin = m.tree ? new Vector3(m.vz / h, 0, -m.vx / h).multiplyScalar(1.2) : new Vector3(m.vz, (Math.random() - .5) * 4, -m.vx).multiplyScalar(.6);
    debris.add(obj, m.tree ? vel.multiplyScalar(.3) : vel, spin, null, m.tree ? 40 : 25);
  }

  /* --------------------------------------- messages ------------------------------------ */

  /** Handles base-building messages; false for anything else. */
  onMessage(m: ServerJsonMessage): boolean {
    switch (m.t) {
      case 'trees': this.applyTrees(m); return true;
      case 'knocked': {
        const next = new Set(m.keys), changed = [...this.knocked].filter((k) => !next.has(k)).concat(m.keys.filter((k) => !this.knocked.has(k)));
        this.knocked = next;
        this.refilter(changed);
        return true;
      }
      case 'knock': this.knockAway(m); return true;
      case 'bodies': this.bodies.apply(m); return true;
      case 'structures':
        this.structures.setAll(m.list);
        for (const s of m.list) this.host.store()?.collision.setOwnerColliders(structureOwner(s.id), structureColliders(s));
        return true;
      case 'structure': {
        this.structures.set(m.s, m.hit);
        this.host.store()?.collision.setOwnerColliders(structureOwner(m.s.id), structureColliders(m.s));
        if (m.hit) {
          const ps = this.host.particles();
          if (ps) ParticleFX.impact(ps, m.hit.x, m.hit.y, m.hit.z);
          if (m.hit.broke) this.host.play('arrowHitHard', m.hit, 1);
        }
        return true;
      }
      case 'structureGone':
        this.structures.remove(m.id);
        this.host.store()?.collision.removeOwnerColliders(structureOwner(m.id));
        return true;
      case 'blueprints':
        this.host.inventory.applyBlueprints(m.progress, m.ready);
        if (m.ready) this.host.play('tradeSuccess');
        return true;
      case 'supply':
        this.supply.apply(m);
        this.publishSupply();
        return true;
      case 'chop': {
        const ps = this.host.particles();
        const color: [number, number, number] = m.kind === 'wood' ? [.55, .38, .2] : m.kind === 'iron' ? [.6, .35, .26] : m.kind === 'copper' ? [.75, .45, .22] : m.kind === 'lead' ? [.4, .43, .48] : [.55, .54, .5];
        ps?.smoke.emit({ x: m.x, y: m.y, z: m.z, spread: 2.4, vy: 2.2, life: .7, size: .07, sizeEnd: .05, color, gravity: 12, alpha: 1, count: 9 });
        this.host.play(m.kind === 'wood' ? 'arrowHitHard' : 'bulletHit', m, .9);
        return true;
      }
      default: return false;
    }
  }

  private publishSupply(): void {
    const msg = this.supply.message;
    this.host.hud.set({ supply: { planes: msg.planes.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw, ownerName: p.ownerName })), targets: msg.planes.map((p) => ({ x: p.tx, z: p.tz })) } });
  }

  /* ---------------------------------------- items -------------------------------------- */

  /** Right-click an item in the inventory: blueprint → place it, radio → order supplies, log → planks. */
  useItem(uid: number): boolean {
    const it = this.host.inventory.get().items.find((i) => i.uid === uid);
    if (!it || this.world?.mode !== 'survival') return false;
    const def = BLUEPRINT_BY_ITEM.get(it.itemId);
    if (def) { this.host.inventory.setOpen(false); this.startPlanning(uid, def); return true; }
    if (it.itemId === 'supply_radio') { this.host.inventory.setOpen(true, 'supply'); return true; }
    if (CRAFTS[it.itemId]) { this.host.conn.sendBuild({ t: 'build', op: 'craft', uid }); return true; }
    return false;
  }

  deposit(blueprint: string, item: string): void { this.host.conn.sendBuild({ t: 'build', op: 'deposit', blueprint: blueprint as 'wood_outpost', item }); }
  claim(blueprint: string): void { this.host.conn.sendBuild({ t: 'build', op: 'claim', blueprint: blueprint as 'wood_outpost' }); }
  /** Orders by radio and closes the inventory, so the plane can be watched coming in. */
  order(entry: string): void {
    this.host.conn.sendBuild({ t: 'build', op: 'order', entry });
    this.host.inventory.setOpen(false);
  }
  private readonly planeKeys = new Map<number, object>();

  /* --------------------------------------- planning ------------------------------------ */

  private startPlanning(uid: number, def: BlueprintDef): void {
    this.plan = { uid, def, rot: 0, yaw: 0, ok: false, x: 0, y: 0, z: 0, reason: null };
    this.hologram.show(def);
    this.host.play('equip');
  }

  cancelPlanning(): boolean {
    if (!this.plan) return false;
    this.plan = null;
    this.hologram.hide();
    this.host.hud.set({ planning: null });
    return true;
  }

  /** Wheel while planning: turn the structure in 15° steps. */
  wheel(dir: number): boolean {
    if (!this.plan) return false;
    this.plan.rot += dir * Math.PI / 12;
    return true;
  }

  /** Left click while planning: build here (the server checks everything again). */
  primary(): boolean {
    const plan = this.plan;
    if (!plan) return false;
    if (!plan.ok) { this.host.toast(raw(plan.reason ?? 'Không thể xây ở đây.')); return true; }
    this.host.conn.sendBuild({ t: 'build', op: 'place', uid: plan.uid, x: plan.x, z: plan.z, yaw: plan.yaw });
    this.cancelPlanning();
    return true;
  }

  private updatePlan(time: number): void {
    const plan = this.plan, me = this.host.local(), store = this.host.store();
    if (!plan) return;
    if (!me || !store || !this.host.inventory.get().items.some((i) => i.uid === plan.uid)) { this.cancelPlanning(); return; }
    const at = placementPoint(plan.def, me.x, me.z, me.yaw);
    const yaw = me.yaw + plan.rot;
    const verdict = checkPlacement(store.collision, plan.def, at.x, at.z, yaw);
    let reason: string | null = verdict.ok ? null : verdict.reason === 'slope' ? 'Mặt đất quá dốc' : verdict.reason === 'water' ? 'Không xây trên nước' : verdict.reason === 'blocked' ? 'Có vật cản (cây, đá, nhà…)' : 'Khu vực chưa tải xong';
    const camp = this.world?.camp, r = Math.hypot(plan.def.w, plan.def.d) / 2;
    if (camp && Math.hypot(at.x - camp.x, at.z - camp.z) < CAMP_BUILD_EXCLUSION + r) reason = `Quá gần căn cứ chính (cần cách ${CAMP_BUILD_EXCLUSION} m)`;
    if (!me.grounded) reason = reason ?? 'Hãy đứng trên mặt đất';
    plan.ok = !reason; plan.reason = reason; plan.x = at.x; plan.z = at.z; plan.y = verdict.y; plan.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.hologram.place(at.x, Number.isFinite(verdict.y) && verdict.y ? verdict.y : me.y, at.z, yaw, plan.ok, time);
    const prev = this.host.hud.get().planning;
    if (!prev || prev.ok !== plan.ok || prev.reason !== reason || prev.name !== plan.def.name) this.host.hud.set({ planning: { name: plan.def.name, ok: plan.ok, reason } });
  }

  /* ---------------------------------------- targets ------------------------------------ */

  targets(px: number, py: number, pz: number): BuildTarget[] {
    const out: BuildTarget[] = [];
    if (this.world?.mode !== 'survival') return out;
    for (const [key, t] of this.trees.list) {
      if (t.logs <= 0) continue;
      // Anywhere along the trunk as it lies.
      const bx = t.x + Math.sin(t.dir) * t.length, bz = t.z + Math.cos(t.dir) * t.length;
      const len2 = (bx - t.x) ** 2 + (bz - t.z) ** 2 || 1;
      const s = Math.max(0, Math.min(1, ((px - t.x) * (bx - t.x) + (pz - t.z) * (bz - t.z)) / len2));
      const cx = t.x + (bx - t.x) * s, cz = t.z + (bz - t.z) * s;
      if (Math.hypot(px - cx, pz - cz) > GATHER_REACH || Math.abs(py - t.y) > 2.5) continue;
      out.push({ kind: 'trunk', x: cx, y: t.y + .5, z: cz, radius: 1.4, label: raw(`Lấy khúc gỗ (còn ${t.logs})`), run: () => this.host.conn.sendBuild({ t: 'build', op: 'log', id: key }) });
    }
    const me = this.host.username();
    for (const d of this.structures.doors()) {
      if (Math.hypot(d.x - px, d.z - pz) > DOOR_REACH || Math.abs(d.y - 1.2 - py) > 2.5) continue;
      const mine = d.ownerName === me;
      out.push({ kind: 'door', x: d.x, y: d.y, z: d.z, radius: 1, label: raw(mine ? (d.open ? 'Đóng cửa' : 'Mở cửa') : `Cửa của ${d.ownerName}`), run: () => this.host.conn.sendBuild({ t: 'build', op: 'door', id: d.id, piece: d.piece }) });
    }
    // Holding an axe by a tree / a pickaxe by a rock: say what a swing does there.
    const held = this.host.equippedItemId();
    const store = this.host.store();
    if (store && (held === 'fire_axe' || held === 'pickaxe')) {
      const assets = held === 'fire_axe' ? TREE_ASSETS : ROCK_ASSETS;
      let best: BuildTarget | null = null, bd = Infinity;
      const pcx = Math.floor(px / 32), pcz = Math.floor(pz / 32);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = store.get(pcx + dx, pcz + dz);
        if (!c || c.lod !== 0) continue;
        for (const p of c.props) {
          if (!assets.has(p.asset)) continue;
          const t = propTransform(c, p), d = Math.hypot(t.x - px, t.z - pz);
          if (d > GATHER_REACH + 2 || d >= bd) continue;
          const key = propKey(c.cx, c.cz, p.lx, p.lz);
          bd = d;
          const label = held === 'fire_axe' ? 'Chặt cây · chuột trái' : this.spent.has(key) ? `${ORE_NAME[rockOre(key)]} · đã cạn` : `${ORE_NAME[rockOre(key)]} · đào bằng chuột trái`;
          best = { kind: 'hint', x: t.x, y: t.y + 1.2, z: t.z, radius: 1.6, label: raw(label), run: () => undefined };
        }
      }
      if (best) out.push(best);
    }
    return out;
  }

  /* ----------------------------------------- frame ------------------------------------- */

  update(dt: number, time: number): void {
    this.trees.update(dt);
    this.bodies.update(this.host.serverNow());
    this.structures.update(time);
    this.supply.update(dt, time);
    // Each transport plane drones overhead, heard from far away.
    for (const [id, g] of this.supply.flying) {
      let key = this.planeKeys.get(id);
      if (!key) this.planeKeys.set(id, (key = {}));
      this.host.planeSound(key, g.position);
    }
    for (const [id, key] of this.planeKeys) if (!this.supply.flying.has(id)) { this.host.planeSound(key, null); this.planeKeys.delete(id); }
    this.updatePlan(time);
  }

  dispose(): void {
    for (const key of this.planeKeys.values()) this.host.planeSound(key, null);
    this.trees.dispose();
    this.structures.dispose();
    this.hologram.dispose();
    this.supply.dispose();
    this.bodies.dispose();
    this.rawChunks.clear();
  }
}

import {
  BLUEPRINTS,
  BLUEPRINT_BY_ID,
  BLUEPRINT_BY_ITEM,
  BRUTE_STRUCTURE_COOLDOWN_MS,
  BRUTE_STRUCTURE_DAMAGE,
  CAMP_BUILD_EXCLUSION,
  CHOPPING_TOOLS,
  CRAFTS,
  DOOR_REACH,
  GATHER_REACH,
  MATERIAL_RESIST,
  MAX_STRUCTURES_PER_PLAYER,
  MINING_TOOLS,
  ORE_NAME,
  PLACE_DISTANCE,
  ROCK_ASSETS,
  ROCK_REGROW_MS,
  ROCK_YIELD,
  SUPPLY_BY_ID,
  SUPPLY_FLIGHT,
  SUPPLY_ZONE_RADIUS,
  TREE_ASSETS,
  TREE_REGROW_MS,
  TRUNK_LIFETIME_MS,
  ZombieVariant,
  mineDrop,
  propKey,
  propTransform,
  rockOre,
  structureOwner,
  structureToWorld,
  treeHits,
  treeLogs,
  wrapAngle,
  type BlueprintProgress,
  type DamageKind,
  type PropInstance,
  type ServerJsonMessage,
  type StructureState,
  type SupplyCrateFall,
  type SupplyPlane,
  type VehicleKind,
} from '@zion/shared';
import { Mask, checkPlacement, makeRayHit, piecesOf, structureColliders, structurePieceOf, type CollisionWorld } from '@zion/physics';
import type { AssetRegistry } from '@zion/assets';
import type { CampSite } from '@zion/worldgen';
import type { WorldService } from '../world/world-service';
import type { PhysicsChunkManager } from './physics-manager';
import type { Player } from './player';
import type { Zombie, ZombieDirector } from './zombies';

export interface BuildingDeps {
  collision: CollisionWorld;
  physics: PhysicsChunkManager;
  world: WorldService;
  registry: AssetRegistry;
  zombies: ZombieDirector;
  camp: CampSite | null;
  supplyZone: CampSite | null;
  players(): Iterable<Player>;
  broadcast(msg: ServerJsonMessage): void;
  reply(p: Player, text: string): void;
  /** Inventory changed: re-derive the loadout and send it. */
  inventoryChanged(p: Player): void;
  dropItem(itemId: string, count: number | undefined, x: number, y: number, z: number): void;
  addCoins(p: Player, amount: number): void;
  /** Same team (doors open for teammates too). */
  teammates(a: string, b: string): boolean;
  /** A supply crate came down: a chest holding these items at (x, y, z). */
  landCrate(items: Array<[string, number]>, x: number, y: number, z: number): void;
  landVehicle(kind: VehicleKind, x: number, y: number, z: number, yaw: number): boolean;
  /** The architect is within trading reach of this player. */
  atArchitect(p: Player): boolean;
  save(structures: StructureState[]): Promise<void>;
  error(err: unknown, what: string): void;
  /** Server clock (ms). */
  now(): number;
}

interface Felled { key: string; cx: number; cz: number; asset: number; x: number; y: number; z: number; scale: number; rotY: number; dir: number; logs: number; at: number; trunkUntil: number; regrowAt: number }
interface Plane { id: number; owner: string; ownerName: string; x0: number; z0: number; dx: number; dz: number; y: number; travelled: number; dropped: boolean; entry: string }
interface Drop extends SupplyCrateFall { items?: Array<[string, number]>; yaw: number }

/**
 * Survival base building, server side: trees felled with an axe (their trunks give logs), rocks
 * mined with a pickaxe, the architect's blueprint ledger, the structures players place (colliders,
 * health per piece, doors, brutes and explosives breaking them) and supply drops by radio.
 */
export class BaseBuilding {
  private readonly felled = new Map<string, Felled>();
  private readonly chops = new Map<string, { n: number; at: number }>();
  private readonly rocks = new Map<string, { used: number; spentUntil: number }>();
  readonly structures = new Map<number, StructureState>();
  private nextStructureId = 1;
  private readonly doorsCloseAt = new Map<string, number>();
  private readonly bruteReadyAt = new WeakMap<Zombie, number>();
  private readonly planes: Plane[] = [];
  private readonly drops: Drop[] = [];
  private nextSupplyId = 1;
  private readonly orderedAt = new Map<string, number>();
  private supplySentAt = 0;
  private dirty = false;
  private savedAt = 0;
  private readonly ray = makeRayHit();

  constructor(private readonly deps: BuildingDeps) {
    deps.physics.propFilter = (cx, cz, p) => !this.felled.has(propKey(cx, cz, p.lx, p.lz));
  }

  /** Saved structures, restored when the world starts. */
  load(list: readonly StructureState[]): void {
    for (const s of list) {
      if (!BLUEPRINT_BY_ID.has(s.blueprint) || !Array.isArray(s.hp)) continue;
      const pieces = piecesOf(s.blueprint);
      const state: StructureState = { ...s, hp: pieces.map((p, i) => Math.min(p.hp, Math.max(0, s.hp[i] ?? p.hp))), open: [] };
      this.structures.set(s.id, state);
      this.install(state);
      this.nextStructureId = Math.max(this.nextStructureId, s.id + 1);
    }
  }

  /** Everything a joining player needs to see. */
  welcome(p: Player): void {
    p.session.sendJson(this.treesMessage());
    p.session.sendJson({ t: 'structures', list: [...this.structures.values()] });
    p.session.sendJson(this.ledger(p));
    p.session.sendJson(this.supplyMessage());
  }

  /* ---------------------------------- trees and rocks ---------------------------------- */

  private treesMessage(): ServerJsonMessage {
    const now = this.deps.now();
    return {
      t: 'trees',
      removed: [...this.felled.keys()],
      trunks: [...this.felled.values()].filter((f) => f.logs > 0 && now < f.trunkUntil).map((f) => ({ key: f.key, asset: f.asset, x: f.x, y: f.y, z: f.z, scale: f.scale, rotY: f.rotY, dir: f.dir, logs: f.logs, at: f.at })),
      spent: [...this.rocks].filter(([, r]) => r.spentUntil > now).map(([k]) => k),
    };
  }

  /** Props of one kind within reach in front of the player, nearest first. */
  private propAhead(p: Player, assets: ReadonlySet<number>): { key: string; cx: number; cz: number; prop: PropInstance; x: number; y: number; z: number; scale: number; rotY: number; d: number } | null {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let best: ReturnType<BaseBuilding['propAhead']> = null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = p.chunkX + dx, cz = p.chunkZ + dz;
      const chunk = this.deps.world.peek(cx, cz, 0)?.data;
      if (!chunk) continue;
      for (const prop of chunk.props) {
        if (!assets.has(prop.asset)) continue;
        const key = propKey(cx, cz, prop.lx, prop.lz);
        if (this.felled.has(key)) continue;
        const t = propTransform(chunk, prop);
        const radius = (this.deps.registry.byNumericId(prop.asset)?.bounds.radius ?? 1) * t.scale;
        // Trunks are thin; rocks are as wide as they look.
        const reach = GATHER_REACH + (ROCK_ASSETS.has(prop.asset) ? radius * .8 : .3);
        const ox = t.x - p.state.x, oz = t.z - p.state.z, d = Math.hypot(ox, oz);
        if (d > reach || Math.abs(t.y - p.state.y) > 3) continue;
        if (d > .6 && (ox * fx + oz * fz) / d < .35) continue;
        if (!best || d < best.d) best = { key, cx, cz, prop, x: t.x, y: t.y, z: t.z, scale: t.scale, rotY: t.rotY, d };
      }
    }
    return best;
  }

  /**
   * A melee blow that hit no one: an axe chops the tree ahead, a pickaxe mines the rock ahead,
   * anything else (and both, when nothing grows there) knocks at a structure wall.
   */
  strike(p: Player, itemId: string | undefined, damage: number, now: number): void {
    if (itemId && CHOPPING_TOOLS.has(itemId)) {
      const tree = this.propAhead(p, TREE_ASSETS);
      if (tree) { this.chop(p, tree, now); return; }
    }
    if (itemId && MINING_TOOLS.has(itemId)) {
      const rock = this.propAhead(p, ROCK_ASSETS);
      if (rock) { this.mine(p, rock, now); return; }
    }
    // A wall in reach ahead.
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), ey = p.state.y + 1.2;
    if (this.deps.collision.raycast(p.state.x, ey, p.state.z, fx, 0, fz, 2.6, Mask.CharacterMovement, this.ray)) {
      const hit = structurePieceOf(this.ray.tag);
      if (hit) this.damagePiece(hit.id, hit.piece, damage, 'melee', this.ray.x, this.ray.y, this.ray.z);
    }
  }

  private chop(p: Player, tree: NonNullable<ReturnType<BaseBuilding['propAhead']>>, now: number): void {
    const c = this.chops.get(tree.key);
    const n = (c && now - c.at < 60_000 ? c.n : 0) + 1;
    this.chops.set(tree.key, { n, at: now });
    this.deps.broadcast({ t: 'chop', x: tree.x, y: tree.y + 1.1, z: tree.z, kind: 'wood' });
    if (n < treeHits(tree.scale)) return;
    this.chops.delete(tree.key);
    // It falls away from the one who cut it.
    const dir = Math.atan2(tree.x - p.state.x, tree.z - p.state.z);
    this.felled.set(tree.key, { key: tree.key, cx: tree.cx, cz: tree.cz, asset: tree.prop.asset, x: tree.x, y: tree.y, z: tree.z, scale: tree.scale, rotY: tree.rotY, dir, logs: treeLogs(tree.scale), at: now, trunkUntil: now + TRUNK_LIFETIME_MS, regrowAt: now + TREE_REGROW_MS });
    this.deps.physics.reload(tree.cx, tree.cz);
    this.deps.broadcast(this.treesMessage());
    this.deps.reply(p, 'Cây đã đổ. Đến gần thân cây và nhấn F để lấy khúc gỗ.');
  }

  private mine(p: Player, rock: NonNullable<ReturnType<BaseBuilding['propAhead']>>, now: number): void {
    const r = this.rocks.get(rock.key) ?? { used: 0, spentUntil: 0 };
    if (r.spentUntil > now) { this.deps.reply(p, 'Mỏ này đã cạn, quay lại sau.'); return; }
    if (r.spentUntil && r.spentUntil <= now) { r.used = 0; r.spentUntil = 0; }
    const ore = rockOre(rock.key);
    this.deps.broadcast({ t: 'chop', x: rock.x, y: rock.y + .6, z: rock.z, kind: ore });
    r.used++;
    // The chunk breaks off and falls at the foot of the rock, on the miner's side.
    const a = Math.atan2(p.state.x - rock.x, p.state.z - rock.z) + (Math.random() - .5) * .9;
    const radius = (this.deps.registry.byNumericId(rock.prop.asset)?.bounds.radius ?? 1) * rock.scale * .8 + .4;
    const x = rock.x + Math.sin(a) * radius, z = rock.z + Math.cos(a) * radius;
    const ground = this.deps.collision.terrainHeight(x, z);
    this.deps.dropItem(mineDrop(ore), 1 + (Math.random() < .3 ? 1 : 0), x, Number.isFinite(ground) ? ground : p.state.y, z);
    if (r.used >= ROCK_YIELD) { r.spentUntil = now + ROCK_REGROW_MS; this.deps.reply(p, `${ORE_NAME[ore]} đã cạn.`); this.deps.broadcast(this.treesMessage()); }
    this.rocks.set(rock.key, r);
  }

  /** F at a felled trunk: one log into the inventory. */
  takeLog(p: Player, key: string, now: number): void {
    const f = this.felled.get(key);
    if (!f || f.logs <= 0 || now >= f.trunkUntil || p.dead) return;
    // Anywhere along the trunk as it lies.
    const len = 6 * f.scale, ax = f.x, az = f.z, bx = ax + Math.sin(f.dir) * len, bz = az + Math.cos(f.dir) * len;
    const t = Math.max(0, Math.min(1, ((p.state.x - ax) * (bx - ax) + (p.state.z - az) * (bz - az)) / (len * len)));
    if (Math.hypot(p.state.x - (ax + (bx - ax) * t), p.state.z - (az + (bz - az) * t)) > GATHER_REACH + .5 || Math.abs(p.state.y - f.y) > 2.5) return;
    if (!p.inv.add('wood_log')) { this.deps.reply(p, 'Túi đồ không đủ chỗ (khúc gỗ chiếm 4 ô).'); return; }
    f.logs--;
    this.deps.inventoryChanged(p);
    this.deps.broadcast(this.treesMessage());
  }

  /** Right-click a log: split it into planks (anything that does not fit falls at your feet). */
  craft(p: Player, uid: number): void {
    const it = p.inv.carriedItem(uid);
    const recipe = it ? CRAFTS[it.itemId] : undefined;
    if (!it || !recipe || p.dead) return;
    p.inv.remove(uid);
    const fitted = p.inv.addUnits(recipe.out, recipe.count);
    if (fitted < recipe.count) this.deps.dropItem(recipe.out, recipe.count - fitted, p.state.x, p.state.y, p.state.z);
    this.deps.inventoryChanged(p);
    this.deps.reply(p, `Đã xẻ khúc gỗ thành ${recipe.count} tấm ván.`);
  }

  /* -------------------------------------- architect ------------------------------------ */

  private ledger(p: Player, ready?: string): ServerJsonMessage {
    const book = p.life?.blueprints ?? {};
    const progress: BlueprintProgress[] = BLUEPRINTS.map((b) => ({ id: b.id, given: { ...(book[b.id] ?? {}) } }));
    return { t: 'blueprints', progress, ...(ready ? { ready } : {}) };
  }

  /** Hand the architect what you carry of one material, up to what the blueprint still needs. */
  deposit(p: Player, blueprint: string, item: string): void {
    const def = BLUEPRINT_BY_ID.get(blueprint);
    if (!def || !(item in def.cost) || p.dead) return;
    if (!this.deps.atArchitect(p)) { this.deps.reply(p, 'Hãy đứng cạnh kỹ sư để giao vật liệu.'); return; }
    const book = (p.life.blueprints ??= {});
    const given = (book[blueprint] ??= {});
    const want = def.cost[item]! - (given[item] ?? 0);
    const n = Math.min(want, p.inv.unitsOf(item));
    if (n <= 0) { p.session.sendJson(this.ledger(p)); return; }
    if (!p.inv.takeUnits(item, n)) return;
    given[item] = (given[item] ?? 0) + n;
    p.dirty = true;
    this.deps.inventoryChanged(p);
    const done = Object.entries(def.cost).every(([k, v]) => (given[k] ?? 0) >= v);
    p.session.sendJson(this.ledger(p, done ? blueprint : undefined));
  }

  /** Everything handed in: the blueprint goes into the inventory. */
  claim(p: Player, blueprint: string): void {
    const def = BLUEPRINT_BY_ID.get(blueprint);
    const given = p.life.blueprints?.[blueprint];
    if (!def || !given || p.dead) return;
    if (!this.deps.atArchitect(p)) { this.deps.reply(p, 'Hãy đứng cạnh kỹ sư để nhận bản vẽ.'); return; }
    if (!Object.entries(def.cost).every(([k, v]) => (given[k] ?? 0) >= v)) return;
    if (!p.inv.add(def.item)) { this.deps.reply(p, 'Túi đồ đầy, hãy dọn chỗ để nhận bản vẽ.'); return; }
    delete p.life.blueprints![blueprint];
    p.dirty = true;
    this.deps.inventoryChanged(p);
    p.session.sendJson(this.ledger(p));
    this.deps.reply(p, `Đã nhận ${def.name}. Chuột phải vào bản vẽ trong túi đồ để đặt công trình.`);
  }

  /* -------------------------------------- structures ----------------------------------- */

  private install(s: StructureState): void {
    this.deps.collision.setOwnerColliders(structureOwner(s.id), structureColliders(s));
  }

  /** Is (x, z) where nothing may be built (the camp, the supply drop zone)? */
  private forbidden(x: number, z: number, r: number): string | null {
    const camp = this.deps.camp, zone = this.deps.supplyZone;
    if (camp && Math.hypot(x - camp.x, z - camp.z) < CAMP_BUILD_EXCLUSION + r) return `Không được dùng bản vẽ trong phạm vi ${CAMP_BUILD_EXCLUSION} m quanh căn cứ chính.`;
    if (zone && Math.hypot(x - zone.x, z - zone.z) < SUPPLY_ZONE_RADIUS + r + 4) return 'Không được xây trên bãi thả hàng tiếp tế.';
    return null;
  }

  place(p: Player, uid: number, x: number, z: number, yaw: number): void {
    const it = p.inv.carriedItem(uid);
    const def = it ? BLUEPRINT_BY_ITEM.get(it.itemId) : undefined;
    if (!it || !def || p.dead || p.downed || p.vehicleId || !p.state.grounded) return;
    const r = Math.hypot(def.w, def.d) / 2;
    if (Math.hypot(x - p.state.x, z - p.state.z) > PLACE_DISTANCE + r + 3) { this.deps.reply(p, 'Vị trí đặt quá xa.'); return; }
    const no = this.forbidden(x, z, r);
    if (no) { this.deps.reply(p, no); return; }
    if ([...this.structures.values()].filter((s) => s.owner === p.accountId).length >= MAX_STRUCTURES_PER_PLAYER) { this.deps.reply(p, `Mỗi người chỉ được giữ ${MAX_STRUCTURES_PER_PLAYER} công trình.`); return; }
    yaw = wrapAngle(yaw);
    const verdict = checkPlacement(this.deps.collision, def, x, z, yaw);
    if (!verdict.ok) {
      this.deps.reply(p, verdict.reason === 'slope' ? 'Mặt đất quá dốc để xây.' : verdict.reason === 'water' ? 'Không thể xây trên mặt nước.' : verdict.reason === 'blocked' ? 'Có vật cản trong khu vực xây.' : 'Khu vực chưa tải xong.');
      return;
    }
    // Nobody (player or zombie) may be shut inside the walls.
    const inside = (ox: number, oz: number) => {
      const lx = (ox - x) * Math.cos(yaw) - (oz - z) * Math.sin(yaw), lz = (ox - x) * Math.sin(yaw) + (oz - z) * Math.cos(yaw);
      return Math.abs(lx) < def.w / 2 + .5 && Math.abs(lz) < def.d / 2 + .5;
    };
    for (const o of this.deps.players()) if (!o.dead && inside(o.state.x, o.state.z)) { this.deps.reply(p, 'Có người đang đứng trong khu vực xây.'); return; }
    if (this.deps.zombies.near(x, z, r + 1).some((zb) => !zb.dead && inside(zb.state.x, zb.state.z))) { this.deps.reply(p, 'Có zombie trong khu vực xây.'); return; }
    p.inv.remove(uid);
    const s: StructureState = { id: this.nextStructureId++, blueprint: def.id, owner: p.accountId, ownerName: p.username, x: +x.toFixed(2), y: +verdict.y.toFixed(2), z: +z.toFixed(2), yaw: +yaw.toFixed(4), hp: piecesOf(def.id).map((pc) => pc.hp), open: [] };
    this.structures.set(s.id, s);
    this.install(s);
    this.dirty = true;
    this.deps.inventoryChanged(p);
    this.deps.broadcast({ t: 'structure', s });
    this.deps.reply(p, `Đã xây ${def.name}. Chuột phải vào cửa để mở / đóng.`);
  }

  /** Open or close a door: the owner and their team only (others have to break it). */
  door(p: Player, id: number, piece: number, now: number): void {
    const s = this.structures.get(id);
    const pc = s ? piecesOf(s.blueprint)[piece] : undefined;
    if (!s || !pc || pc.kind !== 'door' || (s.hp[piece] ?? 0) <= 0 || p.dead) return;
    const [x, z] = structureToWorld(s.x, s.z, s.yaw, pc.x, pc.z);
    if (Math.hypot(p.state.x - x, p.state.z - z) > DOOR_REACH || Math.abs(p.state.y - s.y) > 2.5) return;
    if (s.owner !== p.accountId && !this.deps.teammates(s.owner, p.accountId)) { this.deps.reply(p, `Cửa đã khoá · công trình của ${s.ownerName}.`); return; }
    const open = (s.open ??= []);
    const at = open.indexOf(piece);
    if (at >= 0) open.splice(at, 1);
    else { open.push(piece); this.doorsCloseAt.set(`${id}:${piece}`, now + 7000); }
    this.install(s);
    this.deps.broadcast({ t: 'structure', s });
  }

  private closeDoors(now: number): void {
    for (const [k, at] of this.doorsCloseAt) {
      if (now < at) continue;
      const [id, piece] = k.split(':').map(Number) as [number, number];
      const s = this.structures.get(id);
      if (!s?.open?.includes(piece)) { this.doorsCloseAt.delete(k); continue; }
      const pc = piecesOf(s.blueprint)[piece]!;
      const [x, z] = structureToWorld(s.x, s.z, s.yaw, pc.x, pc.z);
      // Wait while someone stands in the doorway.
      const blocked = [...this.deps.players()].some((o) => !o.dead && Math.hypot(o.state.x - x, o.state.z - z) < 1.2) || this.deps.zombies.near(x, z, 1.2).some((zb) => !zb.dead);
      if (blocked) { this.doorsCloseAt.set(k, now + 1000); continue; }
      this.doorsCloseAt.delete(k);
      s.open.splice(s.open.indexOf(piece), 1);
      this.install(s);
      this.deps.broadcast({ t: 'structure', s });
    }
  }

  /** A hit on one piece, scaled by how well its material stands up to that kind of damage. */
  damagePiece(id: number, piece: number, amount: number, kind: DamageKind, x: number, y: number, z: number): void {
    const s = this.structures.get(id);
    const def = s ? BLUEPRINT_BY_ID.get(s.blueprint) : undefined;
    if (!s || !def || (s.hp[piece] ?? 0) <= 0) return;
    const dealt = Math.max(1, Math.round(amount * MATERIAL_RESIST[def.material][kind]));
    s.hp[piece] = Math.max(0, s.hp[piece]! - dealt);
    const broke = s.hp[piece] === 0;
    this.dirty = true;
    if (broke && piecesOf(s.blueprint)[piece]?.kind === 'core') {
      // The power core gave out: the whole structure comes down.
      s.hp = s.hp.map(() => 0);
      this.structures.delete(id);
      this.deps.collision.removeOwnerColliders(structureOwner(id));
      this.deps.broadcast({ t: 'structure', s, hit: { piece, x, y, z, broke: true } });
      this.deps.broadcast({ t: 'structureGone', id });
      return;
    }
    if (broke) this.install(s);
    this.deps.broadcast({ t: 'structure', s, hit: { piece, x, y, z, broke } });
  }

  /** A bullet stopped on a collider: if it was a structure piece, it takes the hit. */
  bulletHit(tag: number | undefined, damage: number, x: number, y: number, z: number): void {
    const hit = structurePieceOf(tag);
    if (hit) this.damagePiece(hit.id, hit.piece, damage, 'bullet', x, y, z);
  }

  /** Explosions break walls (the falloff runs to the nearest point of each piece). */
  blast(x: number, y: number, z: number, radius: number, damage: number): void {
    for (const s of [...this.structures.values()]) {
      const def = BLUEPRINT_BY_ID.get(s.blueprint)!;
      if (Math.hypot(s.x - x, s.z - z) > radius + Math.hypot(def.w, def.d) / 2) continue;
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), lx = (x - s.x) * c - (z - s.z) * sn, lz = (x - s.x) * sn + (z - s.z) * c, ly = y - s.y;
      piecesOf(s.blueprint).forEach((pc, i) => {
        if ((s.hp[i] ?? 0) <= 0 || !this.structures.has(s.id)) return;
        const d = Math.hypot(Math.max(0, Math.abs(lx - pc.x) - pc.hx), Math.max(0, Math.abs(ly - pc.y) - pc.hy), Math.max(0, Math.abs(lz - pc.z) - pc.hz));
        if (d < radius) this.damagePiece(s.id, i, damage * (1 - d / radius), 'blast', x, y, z);
      });
    }
  }

  /** Brutes chasing someone behind a wall batter their way through it. */
  private brutes(now: number): void {
    for (const s of [...this.structures.values()]) {
      const def = BLUEPRINT_BY_ID.get(s.blueprint)!;
      for (const zb of this.deps.zombies.near(s.x, s.z, Math.hypot(def.w, def.d) / 2 + 3)) {
        if (zb.dead || zb.variant !== ZombieVariant.Brute || !zb.target || now < (this.bruteReadyAt.get(zb) ?? 0)) continue;
        const t = zb.target.state, dx = t.x - zb.state.x, dz = t.z - zb.state.z, d = Math.hypot(dx, dz);
        if (d < .5) continue;
        if (!this.deps.collision.raycast(zb.state.x, zb.state.y + 1.2, zb.state.z, dx / d, 0, dz / d, Math.min(d, 2.4), Mask.CharacterMovement, this.ray)) continue;
        const hit = structurePieceOf(this.ray.tag);
        if (!hit || hit.id !== s.id) continue;
        this.bruteReadyAt.set(zb, now + BRUTE_STRUCTURE_COOLDOWN_MS);
        zb.yaw = Math.atan2(-dx, -dz);
        zb.attackingUntil = now + 700;
        zb.attackReadyAt = now + 900;
        this.damagePiece(s.id, hit.piece, BRUTE_STRUCTURE_DAMAGE, 'brute', this.ray.x, this.ray.y, this.ray.z);
      }
    }
  }

  /* ------------------------------------- supply drops ---------------------------------- */

  private supplyMessage(): ServerJsonMessage {
    const planes: SupplyPlane[] = this.planes.map((pl) => ({ id: pl.id, x: pl.x0 + pl.dx * pl.travelled, z: pl.z0 + pl.dz * pl.travelled, y: pl.y, yaw: Math.atan2(-pl.dx, -pl.dz), owner: pl.owner, ownerName: pl.ownerName }));
    return { t: 'supply', planes, drops: this.drops.map(({ id, kind, vehicle, x, y, z, landed }) => ({ id, kind, vehicle, x, y, z, landed })) };
  }

  /** Radio order: pay, and a transport plane heads for the camp's drop zone. */
  order(p: Player, entryId: string, now: number): void {
    const entry = SUPPLY_BY_ID.get(entryId), zone = this.deps.supplyZone;
    if (!entry || !zone || p.dead) return;
    if (!p.inv.unitsOf('supply_radio')) { this.deps.reply(p, 'Cần có bộ đàm gọi tiếp tế.'); return; }
    if (this.planes.some((pl) => pl.owner === p.accountId) || this.drops.some((d) => !d.landed && (d as Drop & { owner?: string }).owner === p.accountId)) { this.deps.reply(p, 'Đơn hàng trước của bạn vẫn đang được giao.'); return; }
    const wait = (this.orderedAt.get(p.accountId) ?? -Infinity) + SUPPLY_FLIGHT.cooldownMs - now;
    if (wait > 0) { this.deps.reply(p, `Vệ tinh đang bận, thử lại sau ${Math.ceil(wait / 1000)} giây.`); return; }
    if (p.coins < entry.price) { this.deps.reply(p, 'Không đủ ZCoin cho đơn hàng này.'); return; }
    this.deps.addCoins(p, -entry.price);
    this.orderedAt.set(p.accountId, now);
    const a = Math.random() * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    this.planes.push({ id: this.nextSupplyId++, owner: p.accountId, ownerName: p.username, x0: zone.x - dx * SUPPLY_FLIGHT.approach, z0: zone.z - dz * SUPPLY_FLIGHT.approach, dx, dz, y: zone.y + SUPPLY_FLIGHT.altitude, travelled: 0, dropped: false, entry: entry.id });
    this.deps.broadcast({ t: 'chat', from: 'TIẾP TẾ', fromId: 0, system: true, text: `✈ Máy bay vận tải đang chở "${entry.name}" cho ${p.username} tới bãi thả hàng (dấu X đỏ cạnh căn cứ).` });
    this.deps.broadcast(this.supplyMessage());
  }

  private stepSupply(dt: number, now: number): void {
    const zone = this.deps.supplyZone;
    if (!zone || (!this.planes.length && !this.drops.length)) return;
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const pl = this.planes[i]!;
      pl.travelled += SUPPLY_FLIGHT.speed * dt;
      if (!pl.dropped && pl.travelled >= SUPPLY_FLIGHT.approach) {
        pl.dropped = true;
        const entry = SUPPLY_BY_ID.get(pl.entry)!;
        const x = pl.x0 + pl.dx * pl.travelled, z = pl.z0 + pl.dz * pl.travelled;
        const side = (k: number) => [x + pl.dz * k + (Math.random() - .5) * 2, z - pl.dx * k + (Math.random() - .5) * 2] as const;
        if (entry.vehicle) { const [vx, vz] = side(5); this.drops.push({ id: this.nextSupplyId++, kind: 'vehicle', vehicle: entry.vehicle, x: vx, y: pl.y - 6, z: vz, landed: false, yaw: Math.atan2(-pl.dx, -pl.dz), owner: pl.owner } as Drop); }
        if (entry.items) { const [cx, cz] = side(entry.vehicle ? -4 : 0); this.drops.push({ id: this.nextSupplyId++, kind: 'crate', x: cx, y: pl.y - 4, z: cz, landed: false, items: entry.items, yaw: 0, owner: pl.owner } as Drop); }
      }
      if (pl.travelled > SUPPLY_FLIGHT.approach * 2) this.planes.splice(i, 1);
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      if (d.landed) { if (now - ((d as Drop & { landedAt?: number }).landedAt ?? now) > 3000) this.drops.splice(i, 1); continue; }
      d.y -= SUPPLY_FLIGHT.sink * dt;
      const ground = this.deps.collision.terrainHeight(d.x, d.z);
      const floor = Number.isFinite(ground) ? ground : zone.y;
      if (d.y > floor) continue;
      d.y = floor;
      d.landed = true;
      (d as Drop & { landedAt?: number }).landedAt = now;
      if (d.kind === 'vehicle' && d.vehicle) { if (!this.deps.landVehicle(d.vehicle, d.x, floor, d.z, d.yaw)) this.deps.error(new Error('no room'), 'supply vehicle landing'); }
      else if (d.items) this.deps.landCrate(d.items, d.x, floor, d.z);
    }
    if (now - this.supplySentAt >= 200) { this.supplySentAt = now; this.deps.broadcast(this.supplyMessage()); }
  }

  /* ------------------------------------------ tick ------------------------------------- */

  step(dt: number, now: number): void {
    let treesChanged = false;
    for (const [key, f] of this.felled) {
      if (now >= f.regrowAt) { this.felled.delete(key); this.deps.physics.reload(f.cx, f.cz); treesChanged = true; }
      else if (f.logs > 0 && now >= f.trunkUntil) { f.logs = 0; treesChanged = true; }
    }
    for (const [key, r] of this.rocks) if (r.spentUntil && now >= r.spentUntil) { this.rocks.delete(key); treesChanged = true; }
    if (treesChanged) this.deps.broadcast(this.treesMessage());
    this.closeDoors(now);
    this.brutes(now);
    this.stepSupply(dt, now);
    if (this.dirty && now - this.savedAt > 10_000) {
      this.dirty = false;
      this.savedAt = now;
      this.deps.save([...this.structures.values()].map((s) => ({ ...s, open: [] }))).catch((err: unknown) => this.deps.error(err, 'structures save failed'));
    }
  }

  /** Final save on shutdown. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await this.deps.save([...this.structures.values()].map((s) => ({ ...s, open: [] })));
  }
}


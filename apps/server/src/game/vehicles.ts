import { Rng, hashCombine, VEHICLES, VEHICLE_REACH, VEHICLE_ROLES, seatCount, damagePart, partAt, vehicleParts, freshArms, mountedSeat, slewMount, isAircraft, vehicleInReach, vehicleOwner, vehicleSeatOf, vehicleOccupants, vehicleFreeSeat, vehicleLocalPoint, wheelAt, wheelCentre, createVehicleMotion, type VehicleKind, type VehicleState } from '@zion/shared';
import { JoltVehicles, loadJolt, damageVehicle, vehicleHitBounds, heliImpactDamage, stepHelicopter, stepVehicle, vehicleColliders, DEFAULT_CHARACTER, Mask, makeRayHit, type CharacterState, type CollisionWorld } from '@zion/physics';
import { allStructures, makeColumnSample, type WorldGenerator } from '@zion/worldgen';
import type { Player } from './player';


// The server simulates vehicles on Jolt from the first tick.
await loadJolt();

/** A bot in a seat (Warfare): it rides with the vehicle like a player; the driver's bot steers. */
export interface BotRider { id: number; dead: boolean; state: CharacterState; yaw: number; vehicleId: number; vehicleSeat: number }

export class Vehicles {
  readonly states = new Map<number, VehicleState>();
  /** Bots aboard, by id. */
  private readonly botRiders = new Map<number, BotRider>();
  /** Driver controls; `stick` (helicopters): the pilot's mouse cyclic; `bot`: a bot flies by intent. */
  private readonly controls = new Map<number, { throttle: number; steer: number; lift?: number; stick?: readonly [number, number]; bot?: boolean; at: number }>();
  /** Where each manned weapon mount is being pointed (world yaw, pitch), by vehicle and seat. */
  private readonly aims = new Map<number, Map<number, [number, number]>>();
  private readonly usedAt = new Map<number, number>();
  private readonly spawnAt = new Map<number, number>();
  private readonly spawns = new Map<number, { x: number; y: number; z: number; yaw: number }>();
  private readonly struck = new WeakMap<object, Map<number, number>>();
  private readonly physics: JoltVehicles;
  /** Jolt rigid bodies (default) or the built-in arcade model; switchable live from the Studio. */
  jolt = true;
  constructor(private readonly world: CollisionWorld, gen: WorldGenerator) {
    this.physics = new JoltVehicles(world);
    const kinds: VehicleKind[] = ['car', 'jeep', 'quad', 'grizzly'];
    if (gen.config.mode === 'battle-royale') {
      // Battle royale: a pool of parking spots on roads beside inhabited places; every match
      // draws a fresh random selection from it.
      const count = battleVehicleCount(gen);
      this.parking = battleParking(gen, count);
      for (let id = 1; id <= Math.min(count, this.parking.length); id++) {
        const kind = kinds[(id - 1) % 4]!;
        const v: VehicleState = { id, kind, x: 0, y: 0, z: 0, yaw: 0, speed: 0, driver: null, health: VEHICLES[kind].health, explodeAt: 0, exploded: false };
        this.states.set(id, v);
      }
      this.shuffleParking();
      for (const v of this.states.values()) { Object.assign(v, this.spawns.get(v.id)); this.install(v); }
      return;
    }
    const limit = 80;
    for (const segment of gen.roads?.segments ?? []) {
      if (this.states.size >= limit) break;
      if (segment.bridge || segment.length < 15) continue;
      const x = (segment.a.x + segment.b.x) / 2, z = (segment.a.z + segment.b.z) / 2;
      if ([...this.states.values()].some(v => Math.hypot(v.x - x, v.z - z) < 115)) continue;
      if (gen.camp && Math.hypot(x - gen.camp.x, z - gen.camp.z) < 180) continue;
      const y = gen.heightAt(x, z);
      if (y < gen.seaLevel + 1) continue;
      const id = this.states.size + 1;
      const v: VehicleState = { id, kind: kinds[(id - 1) % 4]!, x, y, z, yaw: Math.atan2(segment.a.x - segment.b.x, segment.a.z - segment.b.z), speed: 0, driver: null, health: VEHICLES[kinds[(id - 1) % 4]!].health, explodeAt: 0, exploded: false };
      this.states.set(id, v); this.spawns.set(id, { x, y, z, yaw: v.yaw }); this.install(v);
    }
  }
  private parking: Array<{ x: number; y: number; z: number; yaw: number }> = [];
  /** Picks random, well-separated parking spots for the battle vehicles. */
  private shuffleParking(): void {
    const pool = [...this.parking];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    const chosen: typeof pool = [];
    for (const spot of pool) if (chosen.length < this.states.size && chosen.every(c => Math.hypot(c.x - spot.x, c.z - spot.z) > 60)) chosen.push(spot);
    for (const spot of pool) if (chosen.length < this.states.size && !chosen.includes(spot)) chosen.push(spot);
    [...this.states.values()].forEach((v, i) => this.spawns.set(v.id, { ...chosen[i]! }));
  }
  /** The Jolt system vehicles and free rigid bodies share. */
  get rigid(): JoltVehicles { return this.physics; }
  private install(v: VehicleState): void {
      this.physics.add(v);
    if (!v.arms && (VEHICLE_ROLES[v.kind].weapons.length || VEHICLE_ROLES[v.kind].countermeasure)) v.arms = freshArms(v.kind);
    this.placed.delete(v.id); this.placeColliders(v);
  }
  spawn(p: Player, type: string | undefined, now: number): string {
    const aliases: Record<string, VehicleKind> = { car: 'car', lada: 'car', jeep: 'jeep', quad: 'quad', quadbike: 'quad', grizzly: 'grizzly' };
    const key = type?.toLowerCase();
    const kind = key && Object.hasOwn(aliases, key) ? aliases[key] : undefined;
    if (!kind) return '/vehicle <car|jeep|quad|grizzly>';
    if (p.dead || p.downed || p.state.flight || p.vehicleId) return 'Hãy đứng trên mặt đất và xuống xe trước.';
    if (now - (this.spawnAt.get(p.id) ?? -Infinity) < 3000) return 'Đợi 3 giây trước khi tạo xe tiếp.';
    if (this.states.size >= 160) return 'Bản đồ đã đạt giới hạn phương tiện.';
    const def = VEHICLES[kind];
    for (const distance of [5, 7, 9]) for (const angle of [0, .6, -.6, Math.PI]) {
      const yaw = p.yaw + angle, x = p.state.x - Math.sin(yaw) * distance, z = p.state.z - Math.cos(yaw) * distance;
      const y = this.world.terrainHeight(x, z), reach = Math.hypot(def.halfX, def.halfZ) + .3;
      if (!Number.isFinite(y) || y < this.world.seaLevel + .4 || !this.world.isAreaLoaded(x-reach,z-reach,x+reach,z+reach) || !this.world.inBounds(x-reach,z-reach) || !this.world.inBounds(x+reach,z+reach)) continue;
      let blocked = false;
      for (const dx of [-def.halfX, 0, def.halfX]) for (const dz of [-def.halfZ, 0, def.halfZ]) {
        const px = x + dx * Math.cos(yaw) + dz * Math.sin(yaw), pz = z - dx * Math.sin(yaw) + dz * Math.cos(yaw);
        if (Math.abs(this.world.terrainHeight(px,pz)-y) > .6 || this.world.overlapsCapsule(px,y+.4,pz,px,y+1.5,pz,.35,Mask.CharacterMovement,.04)) blocked=true;
      }
      if (blocked) continue;
      const id = Math.max(0,...this.states.keys())+1;
      const v: VehicleState = {id,kind,x,y,z,yaw:Math.atan2(Math.sin(p.yaw),Math.cos(p.yaw)),speed:0,health:def.health,driver:null,explodeAt:0,exploded:false};
      this.states.set(id,v);this.spawns.set(id,{x,y,z,yaw:v.yaw});this.install(v);this.spawnAt.set(p.id,now);
      return `Đã tạo ${def.name}. Nhấn F để lên/xuống xe.`;
    }
    return 'Không có đủ khoảng trống gần bạn để tạo xe.';
  }
  /** A vehicle delivered at a spot (supply drop): false when the map is at its vehicle limit. */
  deliver(kind: VehicleKind, x: number, y: number, z: number, yaw: number): boolean {
    return this.place(kind, x, y, z, yaw) !== null;
  }
  /** A new vehicle standing at a spot; its id, or null at the map's vehicle limit. */
  place(kind: VehicleKind, x: number, y: number, z: number, yaw: number): number | null {
    if (this.states.size >= 200 || !VEHICLES[kind]) return null;
    const id = Math.max(0, ...this.states.keys()) + 1;
    const v: VehicleState = { id, kind, x, y: y + .1, z, yaw, speed: 0, health: VEHICLES[kind].health, driver: null, explodeAt: 0, exploded: false };
    this.states.set(id, v); this.spawns.set(id, { x, y: v.y, z, yaw }); this.install(v);
    return id;
  }
  driving(p: Player): VehicleState | undefined { return p.vehicleId ? this.states.get(p.vehicleId) : undefined; }
  /** Each vehicle's collision boxes as last installed, and where (reinstalled only once it moved). */
  private readonly placed = new Map<number, { at: [number, number, number, number, number, number]; colliders: ReturnType<typeof vehicleColliders> }>();
  private placeColliders(v: VehicleState): void {
    const m = v.motion, at: [number, number, number, number, number, number] = [v.x, v.y, v.z, v.yaw, m?.pitch ?? 0, m?.roll ?? 0], last = this.placed.get(v.id);
    if (last && Math.abs(last.at[0] - at[0]) + Math.abs(last.at[1] - at[1]) + Math.abs(last.at[2] - at[2]) < .01 && Math.abs(last.at[3] - at[3]) + Math.abs(last.at[4] - at[4]) + Math.abs(last.at[5] - at[5]) < .002) return;
    const colliders = vehicleColliders(v);
    this.placed.set(v.id, { at, colliders });
    this.world.setOwnerColliders(vehicleOwner(v.id), colliders);
  }
  /** A gun's recoil: an impulse (N·s) on the vehicle's body at a world point. */
  recoil(v: VehicleState, dx: number, dy: number, dz: number, x: number, y: number, z: number, impulse: number): void {
    if (this.jolt) this.physics.kick(v.id, dx * impulse, dy * impulse, dz * impulse, x, y, z);
  }
  /** The rider of a seat with a turning mount points it (it follows at its traverse rate). */
  aimAt(v: VehicleState, seat: number, yaw: number, pitch: number): void {
    if (!Number.isFinite(yaw + pitch)) return;
    let m = this.aims.get(v.id);
    if (!m) this.aims.set(v.id, m = new Map());
    m.set(seat, [yaw, pitch]);
  }
  /** Turns every manned mount towards its rider's aim; an empty seat's gun stays where it was left. */
  private slewMounts(dt: number): void {
    for (const [id, seats] of this.aims) {
      const v = this.states.get(id);
      if (!v) { this.aims.delete(id); continue; }
      const crew = [v.driver, ...(v.passengers ?? [])];
      for (const [seat, [yaw, pitch]] of seats) {
        if (!crew[seat] || v.health <= 0) { seats.delete(seat); continue; }
        slewMount(v, seat, yaw, pitch, dt);
      }
    }
  }
  control(p: Player, throttle: number, steer: number, now: number, lift = 0, stick?: readonly [number, number]): void {
    // Only the driver steers; passengers just ride (and shoot). Helicopters: W/S the collective,
    // A/D the cyclic's bank, the mouse (`stick`) the cyclic and pedals.
    if (p.vehicleId && p.vehicleSeat === 0) this.controls.set(p.vehicleId, { throttle, steer, lift, ...(stick ? { stick } : {}), at: now });
  }
  /**
   * A bot gets in: the driver's seat when asked and free, otherwise a free passenger seat. Only an
   * intact vehicle within reach, never one with a seat it would have to share or fight for.
   */
  boardBot(bot: BotRider, v: VehicleState, wantDriver: boolean): boolean {
    if (!this.available || bot.dead || bot.vehicleId || v.health <= 0 || v.exploded || v.explodeAt) return false;
    if (!vehicleInReach(v, bot.state.x, bot.state.z, VEHICLE_REACH - .5) || Math.abs(v.y - bot.state.y) > 3) return false;
    let seat = -1;
    if (wantDriver && !v.driver) seat = 0;
    else for (let i = 1; i < seatCount(v.kind); i++) if (!v.passengers?.[i - 1]) { seat = i; break; }
    if (seat < 0) return false;
    if (seat === 0) v.driver = bot.id;
    else { v.passengers ??= []; while (v.passengers.length < seat) v.passengers.push(0); v.passengers[seat - 1] = bot.id; }
    bot.vehicleId = v.id; bot.vehicleSeat = seat;
    this.botRiders.set(bot.id, bot);
    this.seatBot(bot, v);
    return true;
  }
  /** The driving bot's controls (forward / back, left / right), like a player's keys. */
  driveBot(bot: BotRider, throttle: number, steer: number, now: number, lift = 0): void {
    if (bot.vehicleId && bot.vehicleSeat === 0 && this.botRiders.get(bot.id) === bot) this.controls.set(bot.vehicleId, { throttle: Math.max(-1, Math.min(1, throttle)), steer: Math.max(-1, Math.min(1, steer)), lift: Math.max(-1, Math.min(1, lift)), bot: true, at: now });
  }
  /** A bot gets out beside the vehicle (anywhere it stands clear; on the spot when `force`). */
  exitBot(bot: BotRider, force = false): boolean {
    const v = this.states.get(bot.vehicleId);
    if (!v) { this.botRiders.delete(bot.id); bot.vehicleId = 0; bot.vehicleSeat = 0; return true; }
    const flying = this.inFlight(v);
    const point = flying ? this.jumpPoint(v, bot.vehicleSeat) : this.exitPoint(v);
    if (!point && !force) return false;
    if (v.driver === bot.id) { v.driver = null; this.controls.delete(v.id); }
    if (v.passengers) v.passengers = v.passengers.map((id) => (id === bot.id ? 0 : id));
    this.botRiders.delete(bot.id);
    bot.vehicleId = 0; bot.vehicleSeat = 0;
    if (point) Object.assign(bot.state, point);
    Object.assign(bot.state, { vx: 0, vy: 0, vz: 0, grounded: !flying }, flying ? { flight: 2 } : {});
    return true;
  }
  /** Bots aboard a vehicle. */
  botsIn(v: VehicleState): BotRider[] {
    return vehicleOccupants(v).map((id) => this.botRiders.get(id)).filter((b): b is BotRider => !!b);
  }
  private seatBot(b: BotRider, v: VehicleState): void {
    const seat = Math.max(0, vehicleSeatOf(v, b.id));
    Object.assign(b.state, mountedSeat(v, seat), { vx: -Math.sin(v.yaw) * v.speed, vy: 0, vz: -Math.cos(v.yaw) * v.speed, grounded: true, swimming: false, climbing: false, prone: false });
    if (seat === 0) b.yaw = v.yaw;
  }
  /** A clear spot beside the vehicle to step out to (null when boxed in). */
  private exitPoint(v: VehicleState): { x: number; y: number; z: number } | null {
    this.world.removeOwnerColliders(vehicleOwner(v.id));
    const def = VEHICLES[v.kind], c = Math.cos(v.yaw), s = Math.sin(v.yaw), hit = makeRayHit();
    let point: { x: number; y: number; z: number } | null = null;
    for (const [side, back] of [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1]]) {
      const dx = side! * (def.halfX + 1), dz = back! * (def.halfZ + 1);
      const x = v.x + dx * c + dz * s, z = v.z - dx * s + dz * c, y = this.world.terrainHeight(x, z);
      if (!Number.isFinite(y) || !this.world.inBounds(x, z) || this.world.waterLevel(x, z) > y + .5) continue;
      if (!this.world.isAreaLoaded(x - .4, z - .4, x + .4, z + .4) || this.world.overlapsCapsule(x, y + .4, z, x, y + 1.4, z, .35, Mask.CharacterMovement, .04)) continue;
      const dy = y + 1.2 - (v.y + 1.3), distance = Math.hypot(x - v.x, dy, z - v.z);
      if (this.world.raycast(v.x, v.y + 1.3, v.z, (x - v.x) / distance, dy / distance, (z - v.z) / distance, distance + .3, Mask.LineOfSight, hit)) continue;
      point = { x, y: y + .05, z }; break;
    }
    this.install(v);
    return point;
  }
  /** Runs fn with this vehicle's own collision removed (a passenger's shots leave the cabin). */
  withoutColliders<T>(v: VehicleState, fn: () => T): T {
    this.world.removeOwnerColliders(vehicleOwner(v.id));
    // Put back as installed (a machine gun firing ten times a second must not rebuild the hull's boxes).
    try { return fn(); } finally { const c = this.placed.get(v.id); if (c) this.world.setOwnerColliders(vehicleOwner(v.id), c.colliders); else this.install(v); }
  }
  /**
   * F: get out, or get in. An empty vehicle seats you as its driver; an occupied one takes you
   * on a free seat only if everyone aboard is your teammate (`allied`).
   */
  toggle(p: Player, id: number | undefined, now: number, allied: (otherId: number) => boolean = () => false): void {
    if (!this.available) return;
    if (p.dead || p.downed || p.state.flight || p.questBusy || now - (this.usedAt.get(p.id) ?? -Infinity) < 350) return;
    this.usedAt.set(p.id, now);
    if (this.driving(p)) { this.exit(p); return; }
    const boardable = (v: VehicleState) => v.health > 0 && !v.exploded && vehicleFreeSeat(v) >= 0 && vehicleOccupants(v).every(allied);
    const v = id ? this.states.get(id) : [...this.states.values()].filter((q) => boardable(q) && vehicleInReach(q, p.state.x, p.state.z)).sort((a, b) => Math.hypot(a.x - p.state.x, a.z - p.state.z) - Math.hypot(b.x - p.state.x, b.z - p.state.z))[0];
    if (!v || !boardable(v) || !vehicleInReach(v, p.state.x, p.state.z) || Math.abs(v.y - p.state.y) > 2.5) return;
    // Reach is not enough: do not let F pull players through a wall.
    const dx = v.x - p.state.x, dz = v.z - p.state.z, d = Math.hypot(dx, dz), hit = makeRayHit();
    this.world.removeOwnerColliders(vehicleOwner(v.id));
    const blocked = d > .1 && this.world.raycast(p.state.x, p.state.y + 1.2, p.state.z, dx / d, 0, dz / d, d, Mask.LineOfSight, hit);
    this.install(v);
    if (blocked) return;
    const seat = vehicleFreeSeat(v);
    if (seat === 0) v.driver = p.id;
    else { v.passengers ??= []; while (v.passengers.length < seat) v.passengers.push(0); v.passengers[seat - 1] = p.id; }
    p.vehicleId = v.id; p.vehicleSeat = seat; p.state.prone = false; p.state.crouched = false; p.state.rollTicks = 0; p.strike = null;
    p.history.clear(); this.seat(p, v);
  }
  /** A helicopter high enough that getting out means jumping with a parachute. */
  inFlight(v: VehicleState): boolean {
    const g = this.world.terrainHeight(v.x, v.z);
    return isAircraft(v.kind) && Number.isFinite(g) && v.y - g > 8;
  }
  /** Out of the side door of a flying helicopter: falling, the parachute opens on its own. */
  private jumpPoint(v: VehicleState, seat: number): { x: number; y: number; z: number } {
    const def = VEHICLES[v.kind], side = seat % 2 ? 1 : -1, c = Math.cos(v.yaw), s = Math.sin(v.yaw), dx = side * (def.halfX + 1.4), dz = -def.halfZ * .2;
    return { x: v.x + dx * c + dz * s, y: v.y + .5, z: v.z - dx * s + dz * c };
  }
  exit(p: Player, force = false): boolean {
    const v = this.driving(p);
    if (!v) return true;
    if (this.inFlight(v)) {
      const at = this.jumpPoint(v, p.vehicleSeat);
      if (v.driver === p.id) { v.driver = null; this.controls.delete(v.id); }
      if (v.passengers) v.passengers = v.passengers.map((id) => (id === p.id ? 0 : id));
      p.vehicleId = 0; p.vehicleSeat = 0;
      Object.assign(p.state, at, { vx: -Math.sin(v.yaw) * v.speed * .5, vy: 0, vz: -Math.cos(v.yaw) * v.speed * .5, grounded: false, swimming: false, flight: 2 });
      p.inputs.length = 0; p.history.clear(); p.dirty = true;
      p.session.sendJson({ t: 'respawn', playerId: p.id, x: p.state.x, y: p.state.y, z: p.state.z });
      return true;
    }
    this.world.removeOwnerColliders(vehicleOwner(v.id));
    const def = VEHICLES[v.kind], c = Math.cos(v.yaw), s = Math.sin(v.yaw), hit = makeRayHit();
    let point: { x: number; y: number; z: number } | undefined;
    for (const [side, back] of [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1]]) {
      const dx = side! * (def.halfX + 1), dz = back! * (def.halfZ + 1);
      const x = v.x + dx * c + dz * s, z = v.z - dx * s + dz * c;
      const terrain = this.world.terrainHeight(x, z), water = this.world.waterLevel(x, z);
      const waterExit = terrain < water && v.y < water + 1.5;
      let y = terrain;
      // Exit beside the submerged chassis, then let swimming move the player upwards.
      // Jumping straight to the surface could teleport through a bridge or a roof.
      if (waterExit) y = Math.max(terrain, Math.min(water - DEFAULT_CHARACTER.swimFloatDepth - .05, v.y + .1));
      if (!Number.isFinite(y) || !this.world.inBounds(x, z)) continue;
      if (!this.world.isAreaLoaded(x-.4,z-.4,x+.4,z+.4) || this.world.overlapsCapsule(x,y+.4,z,x,y+1.4,z,.35,Mask.CharacterMovement,.04)) continue;
      const dy=y+1.2-(v.y+1.3),distance = Math.hypot(x - v.x, dy, z - v.z);
      if (this.world.raycast(v.x, v.y + 1.3, v.z, (x - v.x) / distance, dy / distance, (z - v.z) / distance, distance + .3, Mask.LineOfSight, hit)) continue;
      if (!waterExit && this.world.raycast(x, y + .2, z, 0, 1, 0, 1.8, Mask.LineOfSight, hit)) continue;
      point = { x, y: y + .05, z }; break;
    }
    this.install(v);
    if (!point && !force) return false;
    if (v.driver === p.id) { v.driver = null; this.controls.delete(v.id); }
    if (v.passengers) v.passengers = v.passengers.map((id) => (id === p.id ? 0 : id));
    p.vehicleId = 0; p.vehicleSeat = 0;
    if (point) Object.assign(p.state, point);
    const water = this.world.waterLevel(p.state.x, p.state.z), swimming = water - p.state.y > DEFAULT_CHARACTER.swimDepth;
    p.state.vx = p.state.vy = p.state.vz = 0; p.state.grounded = !swimming; p.state.swimming = swimming;
    p.inputs.length = 0; p.history.clear(); p.dirty = true;
    p.session.sendJson({ t: 'respawn', playerId: p.id, x: p.state.x, y: p.state.y, z: p.state.z });
    return true;
  }
  release(p: Player): void { this.exit(p, true); this.usedAt.delete(p.id); }
  private seat(p: Player, v: VehicleState): void {
    const seat = Math.max(0, vehicleSeatOf(v, p.id));
    Object.assign(p.state, mountedSeat(v, seat), { vx: -Math.sin(v.yaw) * v.speed, vy: 0, vz: -Math.cos(v.yaw) * v.speed, grounded: true, swimming: false, climbing: false });
    // The driver faces the road; passengers keep looking where they aim.
    if (seat === 0) p.yaw = v.yaw;
    p.dirty = true;
  }
  /** Players aboard a vehicle who are still in it. */
  private aboard(v: VehicleState, players: ReadonlyMap<number, Player>): Player[] {
    return vehicleOccupants(v).map((id) => players.get(id)).filter((p): p is Player => !!p && p.vehicleId === v.id);
  }
  step(now: number, dt: number, players: ReadonlyMap<number, Player>, explode: (v: VehicleState, occupants: Player[]) => void, impact: (p: Player, speed: number) => void): void {
    this.slewMounts(dt);
    for (const v of this.states.values()) {
      for (const id of vehicleOccupants(v)) {
        const bot = this.botRiders.get(id);
        if (bot) { if (bot.dead || bot.vehicleId !== v.id) this.exitBot(bot, true); continue; }
        const p = players.get(id);
        if (!p || p.dead || p.downed || p.vehicleId !== v.id) {
          if (p && p.vehicleId === v.id) this.release(p);
          else { if (v.driver === id) v.driver = null; if (v.passengers) v.passengers = v.passengers.map((x) => (x === id ? 0 : x)); }
        }
      }
      if (v.explodeAt && now >= v.explodeAt && !v.exploded) {
        v.exploded = true; this.world.removeOwnerColliders(vehicleOwner(v.id));
        const aboard = this.aboard(v, players);
        explode(v, aboard);
        for (const p of aboard) this.release(p);
        for (const b of this.botsIn(v)) this.exitBot(b, true);
        this.install(v);
      }
    }
    if (!this.jolt) {
      this.stepAircraft(now, dt, players, impact);
      this.stepLegacy(now, dt, players, impact);
      // Free bodies stay on Jolt whichever vehicle model drives.
      this.physics.step([], () => undefined, dt, now);
      return;
    }
    // One Jolt step for every vehicle together, so they also collide with each other.
    // Helicopters are rigid bodies flown by rotor forces in the same step (heli-flight).
    const impacts = this.physics.step(this.states.values(), (v) => {
      const input = this.controls.get(v.id), p = v.driver ? players.get(v.driver) ?? this.botRiders.get(v.driver) : undefined;
      const fresh = p && input && now - input.at < 250 && v.health > 0 ? input : undefined;
      if (isAircraft(v.kind)) {
        v.throttle = fresh?.throttle ?? 0;
        // A pilot's controls; a bot's intent; a crew aboard with nobody at the controls holds a
        // hover; an empty one in the air settles slowly down.
        if (fresh && !fresh.bot) return { throttle: 0, steer: 0, heli: { collective: fresh.throttle, bank: fresh.steer, stickX: fresh.stick?.[0] ?? 0, stickY: fresh.stick?.[1] ?? 0 } };
        if (fresh) return { throttle: 0, steer: 0, intent: { climb: (fresh.lift ?? 0) * 7, forward: fresh.throttle, turn: fresh.steer } };
        if (v.motion?.grounded) return v.driver ? { throttle: 0, steer: 0, heli: { collective: -1, bank: 0, stickX: 0, stickY: 0 } } : undefined;
        return { throttle: 0, steer: 0, intent: { climb: v.driver ? 0 : -2.2, forward: 0, turn: 0 } };
      }
      const control = fresh ?? (v.driver ? { throttle: 0, steer: 0 } : undefined);
      v.throttle = control?.throttle ?? 0;
      return control;
    }, dt, now);
    for (const [id, speed] of impacts) {
      const v = this.states.get(id)!;
      this.placeColliders(v);
      for (const p of this.aboard(v, players)) { this.seat(p, v); if (speed > 10) impact(p, speed); }
    }
    this.seatBots();
  }
  /** Helicopters: the pilot's (or bot's) controls through the flight model; crashes hurt. */
  private stepAircraft(now: number, dt: number, players: ReadonlyMap<number, Player>, impact: (p: Player, speed: number) => void): void {
    for (const v of this.states.values()) {
      if (!isAircraft(v.kind) || v.exploded) continue;
      const input = this.controls.get(v.id), pilot = v.driver ? players.get(v.driver) ?? this.botRiders.get(v.driver) : undefined;
      const control = pilot && input && now - input.at < 250 ? { throttle: input.throttle, steer: input.steer, lift: input.lift ?? 0 } : pilot ? { throttle: 0, steer: 0, lift: 0 } : undefined;
      v.throttle = control?.throttle ?? 0;
      this.world.removeOwnerColliders(vehicleOwner(v.id));
      const hit = stepHelicopter(v, control, this.world, dt);
      this.world.setOwnerColliders(vehicleOwner(v.id), vehicleColliders(v));
      const damage = heliImpactDamage(hit);
      if (damage) { damageVehicle(v, damage, now); v.impact = { time: now, speed: hit }; for (const p of this.aboard(v, players)) impact(p, hit + 8); }
      for (const p of this.aboard(v, players)) this.seat(p, v);
    }
  }
  /** Bots ride along wherever their vehicle went this step. */
  private seatBots(): void {
    for (const b of this.botRiders.values()) { const v = this.states.get(b.vehicleId); if (v) this.seatBot(b, v); }
  }
  private stepLegacy(now: number, dt: number, players: ReadonlyMap<number, Player>, impact: (p: Player, speed: number) => void): void {
    for (const v of this.states.values()) {
      if (isAircraft(v.kind)) continue;
      v.throttle = 0;
      if (v.exploded) continue;
      const p = v.driver ? players.get(v.driver) ?? this.botRiders.get(v.driver) : undefined;
      if (!v.driver && Math.abs(v.speed) < .01 && Math.abs(v.motion?.lateral ?? 0) < .01 && v.motion?.grounded && Math.abs(v.motion.vy) < .03) continue;
      this.world.removeOwnerColliders(vehicleOwner(v.id));
      const input = this.controls.get(v.id), fresh = p && input && now - input.at < 250;
      v.throttle = fresh && v.health > 0 ? input.throttle : 0;
      const speed = stepVehicle(v, fresh ? input.throttle : 0, fresh ? input.steer : 0, this.world, dt, now, (id) => {
        const other = this.states.get(id);
        return other && !other.exploded ? other : undefined;
      });
      this.world.setOwnerColliders(vehicleOwner(v.id), vehicleColliders(v));
      for (const rider of this.aboard(v, players)) { this.seat(rider, v); if (speed > 10) impact(rider, speed); }
    }
    this.seatBots();
  }
  dispose(): void { this.physics.dispose(); }
  /**
   * Moving vehicles hit bodies with momentum: damage and knockback follow the closing speed,
   * and the vehicle loses speed by the mass ratio instead of stopping on a pedestrian.
   */
  strike<T extends object>(now: number, bodies: (v: VehicleState, radius: number) => Iterable<T>, position: (t: T) => { x: number; y: number; z: number }, mass: number,
    hit: (target: T, v: VehicleState, damage: number, dirX: number, dirZ: number, impulse: number) => void): void {
    for (const v of this.states.values()) {
      const def = VEHICLES[v.kind], lateral = v.motion?.lateral ?? 0, speed = Math.hypot(v.speed, lateral);
      if (v.exploded || speed < 3) continue;
      const vx = -Math.sin(v.yaw) * v.speed + Math.cos(v.yaw) * lateral, vz = -Math.cos(v.yaw) * v.speed - Math.sin(v.yaw) * lateral;
      for (const target of bodies(v, Math.hypot(def.halfX, def.halfZ) + 1)) {
        const t = position(target), local = vehicleLocalPoint(v, t.x, t.y + .5, t.z);
        if (Math.abs(local.x) > def.halfX + .35 || Math.abs(local.z) > def.halfZ + .35 || local.y < -.6 || local.y > def.height + .3) continue;
        let seen = this.struck.get(target);
        if (!seen) this.struck.set(target, seen = new Map());
        if (now - (seen.get(v.id) ?? -Infinity) < 700) continue;
        // Only the side the vehicle is moving into delivers the blow.
        const dx = t.x - v.x, dz = t.z - v.z, closing = (dx * vx + dz * vz) / Math.max(.3, Math.hypot(dx, dz));
        if (closing < 3) continue;
        seen.set(v.id, now);
        const weight = Math.min(1.4, def.mass / 900), share = mass / (mass + def.mass);
        const px = vx / speed + dx * .4, pz = vz / speed + dz * .4, n = Math.hypot(px, pz) || 1;
        hit(target, v, Math.round((closing - 3) ** 1.35 * 4.2 * weight), px / n, pz / n, closing * .55);
        v.speed *= 1 - share * 1.6;
        if (v.motion) v.motion.lateral = lateral * (1 - share * 1.6);
      }
    }
  }
  /**
   * The first vehicle whose whole body (not just its collision frame: windows and the cabin are
   * open there) a ray hits within `len`: rockets, 40 mm grenades and bolts stop on it.
   */
  hull(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, skip?: number | null): { t: number; id: number } | null {
    let best: { t: number; id: number } | null = null;
    for (const v of this.states.values()) {
      if (v.exploded || v.id === skip || !this.available) continue;
      const { lo, hi } = vehicleHitBounds(v.kind);
      if (Math.hypot(v.x - ox, v.z - oz) > len + Math.max(-lo[2], hi[2]) + 3) continue;
      const a = vehicleLocalPoint(v, ox, oy, oz), b = vehicleLocalPoint(v, ox + dx, oy + dy, oz + dz);
      const d = [b.x - a.x, b.y - a.y, b.z - a.z], o = [a.x, a.y, a.z];
      let t0 = 0, t1 = len;
      for (let i = 0; i < 3 && t0 <= t1; i++) {
        if (Math.abs(d[i]!) < 1e-9) { if (o[i]! < lo[i]! || o[i]! > hi[i]!) t0 = Infinity; continue; }
        let ta = (lo[i]! - o[i]!) / d[i]!, tb = (hi[i]! - o[i]!) / d[i]!;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && t0 <= len && (!best || t0 < best.t)) best = { t: t0, id: v.id };
    }
    return best;
  }
  /** The first tyre a ray meets within `len` (wheels stick out of the body's collision frame). */
  tyreOnRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): { t: number; v: VehicleState; wheel: number } | null {
    let best: { t: number; v: VehicleState; wheel: number } | null = null;
    for (const v of this.states.values()) {
      if (v.exploded || !this.available || Math.hypot(v.x - ox, v.z - oz) > len + VEHICLES[v.kind].halfZ + 2) continue;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw), r = VEHICLES[v.kind].wheelRadius;
      for (let i = 0; i < 4; i++) {
        const c = wheelCentre(v.kind, i), cx = v.x + rx * c.x - fx * c.z - ox, cy = v.y + c.y - oy, cz = v.z + rz * c.x - fz * c.z - oz;
        const along = cx * dx + cy * dy + cz * dz, miss = cx * cx + cy * cy + cz * cz - along * along;
        if (along < 0 || along > len || miss > r * r) continue;
        const t = along - Math.sqrt(r * r - miss);
        if (!best || t < best.t) best = { t: Math.max(0, t), v, wheel: i };
      }
    }
    return best;
  }
  /** Pops one tyre. */
  puncture(v: VehicleState, wheel: number): void { v.flats = (v.flats ?? 0) | (1 << wheel); }

  /** A round stopped at (x, y, z): any bullet pops the tyre it lands on; heavy ones dent the body. */
  hitAt(x: number, y: number, z: number, amount: number, now: number, colliderTag?: number): void {
    if (colliderTag === undefined || colliderTag < 50001) return;
    for (const v of this.states.values()) {
      if (v.exploded || colliderTag !== 50000+v.id) continue;
      const wheel = wheelAt(v, x, y, z);
      if (wheel >= 0) { v.flats = (v.flats ?? 0) | (1 << wheel); break; }
      // Armour shrugs off rounds lighter than its rating (tanks ignore rifles, APCs most of them).
      if (amount < Math.max(25, VEHICLE_ROLES[v.kind].armor)) break;
      const p=vehicleLocalPoint(v,x,y,z),{lo,hi}=vehicleHitBounds(v.kind);
      // The hull takes it, and so does the part it lands on (engine, tracks, turret, gun, rotors…).
      if(p.x>=lo[0]-.12&&p.x<=hi[0]+.12&&p.z>=lo[2]-.12&&p.z<=hi[2]+.12&&p.y>=0&&p.y<=hi[1]+.12) {damageVehicle(v,amount*.6,now);damagePart(v,partAt(v,x,y,z),amount*.6);break;}
    }
  }
  blast(x: number, y: number, z: number, radius: number, damage: number, now: number): void {
    for (const v of this.states.values()) {
      const d = Math.hypot(v.x - x, v.y + .6 - y, v.z - z);
      if (d < radius) {
        const dmg = damage * (1 - d / radius) * VEHICLE_ROLES[v.kind].blastFactor;
        damageVehicle(v, dmg, now);
        // A blast shakes every part, the nearest most.
        for (const part of vehicleParts(v.kind)) damagePart(v, part, dmg * (part === partAt(v, x, y, z) ? .8 : .25));
      }
      // Tyres close to a blast burst.
      if (!v.exploded) for (let i = 0; i < 4; i++) {
        const c = wheelCentre(v.kind, i), fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
        if (Math.hypot(v.x + rx * c.x - fx * c.z - x, v.y + c.y - y, v.z + rz * c.x - fz * c.z - z) < radius * .6) v.flats = (v.flats ?? 0) | (1 << i);
      }
    }
  }
  /** False hides every vehicle (battle royale before the drop): none are sent or usable. */
  available = true;
  /**
   * A player's vehicle snapshot (interest: within 420 m, or aboard). Only vehicles whose state
   * changed since they last got it are sent in full (a parked one is refreshed every 2 s); `ids`
   * lists every vehicle in their interest so the client drops the rest. A snapshot with nothing
   * new is not sent at all.
   */
  send(p: Player, now: number): void {
    const near = !this.available ? [] : [...this.states.values()].filter(v => vehicleSeatOf(v, p.id) >= 0 || Math.hypot(v.x - p.state.x, v.z - p.state.z) < 420);
    let memo = this.sent.get(p);
    if (!memo) this.sent.set(p, memo = { ids: '', at: new Map() });
    const changed: VehicleState[] = [];
    for (const v of near) {
      const json = this.snapshotJson(v, now), last = memo.at.get(v.id);
      if (!last || last.json !== json || now - last.at > 2000 || vehicleSeatOf(v, p.id) >= 0) { changed.push(v); memo.at.set(v.id, { json, at: now }); }
    }
    const ids = near.map((v) => v.id), key = ids.join(',');
    for (const id of memo.at.keys()) if (!ids.includes(id)) memo.at.delete(id);
    if (!changed.length && key === memo.ids) return;
    memo.ids = key;
    const t0 = performance.now(), message = { t: 'vehicles' as const, time: now, ...(p.vehicleId && p.vehicleSeat === 0 ? { ack: p.lastProcessedSeq } : {}), ids, vehicles: changed };
    p.session.sendJson(message);
    this.netStats.messages++; this.netStats.vehicles += changed.length; this.netStats.skipped += near.length - changed.length; this.netStats.ms += performance.now() - t0;
  }
  /** Each vehicle's snapshot serialised once per tick, shared by every recipient's comparison. */
  private snapshotJson(v: VehicleState, now: number): string {
    const known = this.snapshots.get(v.id);
    if (known?.at === now) return known.json;
    const json = JSON.stringify(v);
    this.snapshots.set(v.id, { at: now, json });
    return json;
  }
  private readonly snapshots = new Map<number, { at: number; json: string }>();
  private readonly sent = new WeakMap<Player, { ids: string; at: Map<number, { json: string; at: number }> }>();
  /** Vehicle snapshots: messages, vehicles sent in full, unchanged ones left out, time spent (ms), since start. */
  readonly netStats = { messages: 0, vehicles: 0, skipped: 0, ms: 0 };
  /** Takes a vehicle off the map for good (eject its occupants first). */
  remove(id: number): void {
    const v = this.states.get(id);
    if (!v) return;
    for (const b of this.botsIn(v)) this.exitBot(b, true);
    this.world.removeOwnerColliders(vehicleOwner(id));
    this.physics.remove(id);
    this.states.delete(id); this.controls.delete(id); this.spawns.delete(id); this.placed.delete(id);
  }
  reset(): void {
    this.controls.clear(); this.usedAt.clear(); this.spawnAt.clear();
    if (this.parking.length) this.shuffleParking();
    for (const v of this.states.values()) { Object.assign(v, this.spawns.get(v.id)); v.health = VEHICLES[v.kind].health; v.exploded = false; v.explodeAt = 0; v.driver = null; v.passengers = []; v.speed = 0; v.braking=false;delete v.impact;v.flats=0;v.motion=createVehicleMotion(v.kind); this.install(v); }
  }
}

const BATTLE_VEHICLES = 36;
/** Vehicles a battle royale match has: the map's own number (World Studio maps), else 36. */
export function battleVehicleCount(gen: WorldGenerator): number {
  const wanted = gen.config.battleIsland?.vehicles;
  return Math.max(0, Math.min(120, wanted ?? BATTLE_VEHICLES));
}
/**
 * Parking spots for the battle vehicles, at least `count` of them on any map — abandoned, ruined
 * or wild ones too: first on the verges beside the settlements, then along every other road,
 * then round the settlements' edges (yards, car parks, the approach), and last on any flat dry
 * open ground. Spots are spread out, on land, out of the water and clear of the buildings.
 */
export function battleParking(gen: WorldGenerator, count = BATTLE_VEHICLES): Array<{ x: number; y: number; z: number; yaw: number }> {
  const sites = allStructures(gen).filter(s => s.radius > 10 && s.parts.length > 2);
  const spots: Array<{ x: number; y: number; z: number; yaw: number }> = [];
  const column = makeColumnSample();
  const ok = (x: number, z: number, spacing: number) => {
    if (x < 8 || z < 8 || x > gen.worldSize - 8 || z > gen.worldSize - 8) return null;
    if (spots.some(p => Math.hypot(p.x - x, p.z - z) < spacing)) return null;
    if (sites.some(s => Math.hypot(s.x - x, s.z - z) < Math.min(s.radius, 30))) return null;
    const y = gen.heightAt(x, z);
    if (y < gen.seaLevel + 1 || Math.abs(gen.heightAt(x + 2, z) - y) > .6 || Math.abs(gen.heightAt(x, z + 2) - y) > .6) return null;
    gen.sampleColumn(x, z, column);
    return column.water === column.water ? null : y;
  };
  const segments = gen.roads?.segments ?? [];
  // 1–2. Road verges: by the settlements first, then anywhere on the network.
  for (const nearSites of [true, false]) for (const segment of segments) {
    if (!nearSites && spots.length >= count) break;
    if (segment.bridge || segment.halfWidth > 14) continue;
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z, length = Math.hypot(dx, dz);
    if (length < 1) continue;
    // Park on the verge, beside the carriageway.
    const nx = -dz / length, nz = dx / length, side = spots.length % 2 ? 1 : -1;
    const x = (segment.a.x + segment.b.x) / 2 + nx * side * (segment.halfWidth + 1.6), z = (segment.a.z + segment.b.z) / 2 + nz * side * (segment.halfWidth + 1.6);
    if (nearSites !== sites.some(s => Math.hypot(s.x - x, s.z - z) < s.radius + 45)) continue;
    const y = ok(x, z, nearSites ? 25 : 70);
    if (y !== null) spots.push({ x, y, z, yaw: Math.atan2(-dx, -dz) });
  }
  // 3. Round the settlements: a ring just outside each site.
  for (let ring = 0; ring < 3 && spots.length < count; ring++) for (const s of sites) {
    if (spots.length >= count) break;
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4 + ring * .4 + s.x * .001, r = s.radius + 10 + ring * 14, x = s.x + Math.cos(ang) * r, z = s.z + Math.sin(ang) * r;
      const y = ok(x, z, 30);
      if (y !== null) { spots.push({ x, y, z, yaw: ang + Math.PI / 2 }); break; }
    }
  }
  // 4. Open ground: flat, dry land anywhere (wild maps with no roads or towns).
  const rng = new Rng(hashCombine(gen.seed, 0x7e41c1e));
  for (let tries = 0; tries < 6000 && spots.length < count; tries++) {
    const x = gen.worldSize * (.05 + rng.next() * .9), z = gen.worldSize * (.05 + rng.next() * .9), y = ok(x, z, 90);
    if (y !== null) spots.push({ x, y, z, yaw: rng.next() * Math.PI * 2 });
  }
  return spots;
}

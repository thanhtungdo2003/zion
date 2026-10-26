import { VEHICLES, VEHICLE_REACH, vehicleOwner, vehicleSeat, vehicleSeatOf, vehicleOccupants, vehicleFreeSeat, vehicleLocalPoint, wheelAt, wheelCentre, createVehicleMotion, type VehicleKind, type VehicleState } from '@zion/shared';
import { JoltVehicles, loadJolt, damageVehicle, stepVehicle, vehicleColliders, DEFAULT_CHARACTER, Mask, makeRayHit, type CollisionWorld } from '@zion/physics';
import { allStructures, type WorldGenerator } from '@zion/worldgen';
import type { Player } from './player';


// The server simulates vehicles on Jolt from the first tick.
await loadJolt();

export class Vehicles {
  readonly states = new Map<number, VehicleState>();
  private readonly controls = new Map<number, { throttle: number; steer: number; at: number }>();
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
      this.parking = battleParking(gen);
      for (let id = 1; id <= Math.min(BATTLE_VEHICLES, this.parking.length); id++) {
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
  private install(v: VehicleState): void { this.physics.add(v); this.world.setOwnerColliders(vehicleOwner(v.id), vehicleColliders(v)); }
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
    if (this.states.size >= 200 || !VEHICLES[kind]) return false;
    const id = Math.max(0, ...this.states.keys()) + 1;
    const v: VehicleState = { id, kind, x, y: y + .1, z, yaw, speed: 0, health: VEHICLES[kind].health, driver: null, explodeAt: 0, exploded: false };
    this.states.set(id, v); this.spawns.set(id, { x, y: v.y, z, yaw }); this.install(v);
    return true;
  }
  driving(p: Player): VehicleState | undefined { return p.vehicleId ? this.states.get(p.vehicleId) : undefined; }
  control(p: Player, throttle: number, steer: number, now: number): void {
    // Only the driver steers; passengers just ride (and shoot).
    if (p.vehicleId && p.vehicleSeat === 0) this.controls.set(p.vehicleId, { throttle, steer, at: now });
  }
  /** Runs fn with this vehicle's own collision removed (a passenger's shots leave the cabin). */
  withoutColliders<T>(v: VehicleState, fn: () => T): T {
    this.world.removeOwnerColliders(vehicleOwner(v.id));
    try { return fn(); } finally { this.install(v); }
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
    const v = id ? this.states.get(id) : [...this.states.values()].filter(boardable).sort((a, b) => Math.hypot(a.x - p.state.x, a.z - p.state.z) - Math.hypot(b.x - p.state.x, b.z - p.state.z))[0];
    if (!v || !boardable(v) || Math.hypot(v.x - p.state.x, v.z - p.state.z) > VEHICLE_REACH || Math.abs(v.y - p.state.y) > 2.5) return;
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
  exit(p: Player, force = false): boolean {
    const v = this.driving(p);
    if (!v) return true;
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
    Object.assign(p.state, vehicleSeat(v, seat), { vx: -Math.sin(v.yaw) * v.speed, vy: 0, vz: -Math.cos(v.yaw) * v.speed, grounded: true, swimming: false, climbing: false });
    // The driver faces the road; passengers keep looking where they aim.
    if (seat === 0) p.yaw = v.yaw;
    p.dirty = true;
  }
  /** Players aboard a vehicle who are still in it. */
  private aboard(v: VehicleState, players: ReadonlyMap<number, Player>): Player[] {
    return vehicleOccupants(v).map((id) => players.get(id)).filter((p): p is Player => !!p && p.vehicleId === v.id);
  }
  step(now: number, dt: number, players: ReadonlyMap<number, Player>, explode: (v: VehicleState, occupants: Player[]) => void, impact: (p: Player, speed: number) => void): void {
    for (const v of this.states.values()) {
      for (const id of vehicleOccupants(v)) {
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
        this.install(v);
      }
    }
    if (!this.jolt) {
      this.stepLegacy(now, dt, players, impact);
      // Free bodies stay on Jolt whichever vehicle model drives.
      this.physics.step([], () => undefined, dt, now);
      return;
    }
    // One Jolt step for every vehicle together, so they also collide with each other.
    const impacts = this.physics.step(this.states.values(), (v) => {
      const input = this.controls.get(v.id), p = v.driver ? players.get(v.driver) : undefined;
      const control = p && input && now - input.at < 250 ? input : v.driver ? { throttle: 0, steer: 0 } : undefined;
      v.throttle = control?.throttle ?? 0;
      return control;
    }, dt, now);
    for (const [id, speed] of impacts) {
      const v = this.states.get(id)!;
      this.world.setOwnerColliders(vehicleOwner(v.id), vehicleColliders(v));
      for (const p of this.aboard(v, players)) { this.seat(p, v); if (speed > 10) impact(p, speed); }
    }
  }
  private stepLegacy(now: number, dt: number, players: ReadonlyMap<number, Player>, impact: (p: Player, speed: number) => void): void {
    for (const v of this.states.values()) {
      v.throttle = 0;
      if (v.exploded) continue;
      const p = v.driver ? players.get(v.driver) : undefined;
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
      const def = VEHICLES[v.kind];
      if (Math.hypot(v.x - ox, v.z - oz) > len + def.halfZ + 3) continue;
      const a = vehicleLocalPoint(v, ox, oy, oz), b = vehicleLocalPoint(v, ox + dx, oy + dy, oz + dz);
      const d = [b.x - a.x, b.y - a.y, b.z - a.z], o = [a.x, a.y, a.z], lo = [-def.halfX, .2, -def.halfZ], hi = [def.halfX, def.height, def.halfZ];
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
      if (amount < 25) break;
      const p=vehicleLocalPoint(v,x,y,z),def=VEHICLES[v.kind];
      if(Math.abs(p.x)<=def.halfX+.12&&Math.abs(p.z)<=def.halfZ+.12&&p.y>=0&&p.y<=def.height+.12) {damageVehicle(v,amount*.6,now);break;}
    }
  }
  blast(x: number, y: number, z: number, radius: number, damage: number, now: number): void {
    for (const v of this.states.values()) {
      const d = Math.hypot(v.x - x, v.y + .6 - y, v.z - z);
      if (d < radius) damageVehicle(v, damage * (1 - d / radius), now);
      // Tyres close to a blast burst.
      if (!v.exploded) for (let i = 0; i < 4; i++) {
        const c = wheelCentre(v.kind, i), fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
        if (Math.hypot(v.x + rx * c.x - fx * c.z - x, v.y + c.y - y, v.z + rz * c.x - fz * c.z - z) < radius * .6) v.flats = (v.flats ?? 0) | (1 << i);
      }
    }
  }
  /** False hides every vehicle (battle royale before the drop): none are sent or usable. */
  available = true;
  send(p: Player, now: number): void {
    p.session.sendJson({ t: 'vehicles', time: now, vehicles: !this.available ? [] : [...this.states.values()].filter(v => vehicleSeatOf(v, p.id) >= 0 || Math.hypot(v.x - p.state.x, v.z - p.state.z) < 420) });
  }
  reset(): void {
    this.controls.clear(); this.usedAt.clear(); this.spawnAt.clear();
    if (this.parking.length) this.shuffleParking();
    for (const v of this.states.values()) { Object.assign(v, this.spawns.get(v.id)); v.health = VEHICLES[v.kind].health; v.exploded = false; v.explodeAt = 0; v.driver = null; v.passengers = []; v.speed = 0; v.braking=false;delete v.impact;v.flats=0;v.motion=createVehicleMotion(v.kind); this.install(v); }
  }
}

const BATTLE_VEHICLES = 36;
/** Road-side spots within reach of a building site, spaced along the road network. */
function battleParking(gen: WorldGenerator): Array<{ x: number; y: number; z: number; yaw: number }> {
  const sites = allStructures(gen).filter(s => s.radius > 10 && s.parts.length > 2);
  const spots: Array<{ x: number; y: number; z: number; yaw: number }> = [];
  for (const segment of gen.roads?.segments ?? []) {
    if (segment.bridge || segment.halfWidth > 14) continue;
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z, length = Math.hypot(dx, dz);
    if (length < 1) continue;
    // Park on the verge, beside the carriageway.
    const nx = -dz / length, nz = dx / length, side = spots.length % 2 ? 1 : -1;
    const x = (segment.a.x + segment.b.x) / 2 + nx * side * (segment.halfWidth + 1.6), z = (segment.a.z + segment.b.z) / 2 + nz * side * (segment.halfWidth + 1.6);
    if (!sites.some(s => Math.hypot(s.x - x, s.z - z) < s.radius + 45)) continue;
    if (sites.some(s => Math.hypot(s.x - x, s.z - z) < Math.min(s.radius, 30))) continue;
    if (spots.some(p => Math.hypot(p.x - x, p.z - z) < 25)) continue;
    const y = gen.heightAt(x, z);
    if (y < gen.seaLevel + 1 || Math.abs(gen.heightAt(x + 2, z) - y) > .6 || Math.abs(gen.heightAt(x, z + 2) - y) > .6) continue;
    spots.push({ x, y, z, yaw: Math.atan2(-dx, -dz) });
  }
  return spots;
}

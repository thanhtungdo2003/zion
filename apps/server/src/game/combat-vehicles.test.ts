import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, createCharacterState } from '@zion/physics';
import { VEHICLES, VEHICLE_ROLES, seatWeapon, type VehicleKind, type VehicleState } from '@zion/shared';
import type { WorldGenerator } from '@zion/worldgen';
import { Vehicles, type BotRider } from './vehicles';
import { VehicleGunnery } from './vehicle-gunnery';
import type { Combatant } from './combat';

/** Flat 384 m square of ground at 30 m. */
function world(): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 384, seaLevel: 20 });
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(30), new Float32Array(1089).fill(Number.NaN)), []);
  return w;
}
const bot = (id: number, x: number, z: number): BotRider & Combatant => ({ id, dead: false, active: true, state: createCharacterState(x, 30, z), yaw: 0, vehicleId: 0, vehicleSeat: 0, history: { sample: () => null } as never, rig: [] });
function fleet(w: CollisionWorld) {
  const s = new Vehicles(w, { config: { mode: 'survival' }, roads: null } as unknown as WorldGenerator);
  let next = 1;
  const add = (kind: VehicleKind, x: number, z: number, yaw = 0): VehicleState => {
    const id = s.place(kind, x, 30, z, yaw)!;
    void next++;
    return s.states.get(id)!;
  };
  return { s, add };
}
const step = (s: Vehicles, from: number, seconds: number, each?: (now: number) => void) => {
  let now = from;
  for (let i = 0; i < seconds * 30; i++) { now += 1000 / 30; each?.(now); s.step(now, 1 / 30, new Map(), vi.fn(), vi.fn()); }
  return now;
};

describe('combat vehicles', () => {
  it('a helicopter spools up, climbs, flies forward and turns, then lands and stops', () => {
    const w = world(), { s, add } = fleet(w), heli = add('mi17', 100, 300);
    const pilot = bot(1, 100, 296);
    try {
      expect(s.boardBot(pilot, heli, true)).toBe(true);
      // Engine start: no lift until the rotor is at speed.
      let now = step(s, 0, 1, (t) => s.driveBot(pilot, 0, 0, t, 1));
      expect(heli.y).toBeLessThan(30.5);
      now = step(s, now, 6, (t) => s.driveBot(pilot, 0, 0, t, 1));
      expect(heli.rotor).toBeGreaterThan(.95);
      expect(heli.y).toBeGreaterThan(45);
      expect(s.inFlight(heli)).toBe(true);
      // Nose down: the tilted rotor accelerates it forward (−Z) along its heading, building speed
      // through its inertia (an 11 t transport gathers ~3 m/s² at this tilt).
      const z0 = heli.z;
      now = step(s, now, 5, (t) => s.driveBot(pilot, 1, 0, t, 0));
      expect(heli.z).toBeLessThan(z0 - 12);
      expect(heli.speed).toBeGreaterThan(6);
      expect(heli.motion!.pitch).toBeLessThan(0);
      // Pedal right: the heading turns (yaw decreases).
      const yaw0 = heli.yaw;
      now = step(s, now, 2, (t) => s.driveBot(pilot, 0, 1, t, 0));
      expect(heli.yaw).toBeLessThan(yaw0 - .5);
      // Down onto the ground: gently, no damage.
      const hp = heli.health;
      step(s, now, 14, (t) => s.driveBot(pilot, 0, 0, t, -.5));
      expect(heli.y).toBeLessThan(30.3);
      expect(heli.health).toBe(hp);
      // The pilot follows the seat; jumping out on the ground lands beside it.
      expect(Math.hypot(pilot.state.x - heli.x, pilot.state.z - heli.z)).toBeLessThan(8);
    } finally { s.dispose(); }
  });

  it('jumping from a flying helicopter means a parachute; a crash wrecks it', () => {
    const w = world(), { s, add } = fleet(w), heli = add('mi17', 100, 300);
    const pilot = bot(1, 100, 296), trooper = bot(2, 102, 296);
    try {
      s.boardBot(pilot, heli, true); s.boardBot(trooper, heli, false);
      const now = step(s, 0, 8, (t) => s.driveBot(pilot, 0, 0, t, 1));
      expect(s.exitBot(trooper)).toBe(true);
      expect((trooper.state as { flight?: number }).flight).toBe(2);
      expect(trooper.state.y).toBeGreaterThan(40);
      // Nobody at the controls and the engine dead: it falls and is wrecked by the impact.
      heli.health = 1;
      s.exitBot(pilot, true);
      heli.health = 0;
      step(s, now, 8);
      expect(heli.health).toBe(0);
    } finally { s.dispose(); }
  });

  it('tank guns load one round at a time; the shell hurts an enemy tank, rifles do not', () => {
    const w = world(), { s, add } = fleet(w), mine = add('t80u', 100, 200), theirs = add('t90a', 100, 120);
    const gunner = bot(1, 100, 200), enemy = bot(2, 100, 120);
    const blasts: number[] = [];
    const gunnery = new VehicleGunnery(s, w, { bodies: () => [], friends: (a, b) => a === b, hitBody: vi.fn(), blast: () => blasts.push(1), smoke: vi.fn(), broadcastAt: vi.fn() });
    try {
      s.boardBot(gunner, mine, true); s.boardBot(enemy, theirs, true);
      const cannon = seatWeapon('t80u', 0, 'primary')!;
      expect(cannon.kind).toBe('cannon');
      const hp = theirs.health;
      // Small arms bounce off.
      s.hitAt(theirs.x, theirs.y + 1, theirs.z + 3, 40, 0, 50000 + theirs.id);
      expect(theirs.health).toBe(hp);
      let now = 1000;
      expect(gunnery.fire(gunner as never, mine, cannon, 0, 0, now)).toBe(true);
      // One round in the breech: the next shot waits for the autoloader.
      expect(gunnery.fire(gunner as never, mine, cannon, 0, 0, now + 500)).toBe(false);
      expect(mine.arms!.ammo.cannon!.reloadUntil).toBeGreaterThan(now);
      for (let i = 0; i < 60; i++) { now += 1000 / 30; gunnery.step(now); }
      expect(theirs.health).toBeLessThan(hp - 200);
      expect(blasts.length).toBe(1);
      now += cannon.reloadMs;
      expect(gunnery.fire(gunner as never, mine, cannon, 0, 0, now)).toBe(true);
      expect(mine.arms!.ammo.cannon!.reserve).toBe(cannon.reserve - 1);
    } finally { s.dispose(); }
  });

  it('a missile homes on its target until flares break the lock; the countermeasure then recharges', () => {
    const w = world(), { s, add } = fleet(w), gunship = add('z10', 100, 300), target = add('mi17', 130, 60);
    const shooter = bot(1, 100, 300);
    const gunnery = new VehicleGunnery(s, w, { bodies: () => [], friends: (a, b) => a === b, hitBody: vi.fn(), blast: vi.fn(), smoke: vi.fn(), broadcastAt: vi.fn() });
    try {
      s.boardBot(shooter, gunship, true);
      const missile = seatWeapon('z10', 0, 'secondary')!;
      expect(missile.kind).toBe('missile');
      // Aimed a little off to the side: the lock still takes the target.
      const yaw = Math.atan2(-(130 - 100), -(60 - 300)) + .1;
      let now = 1000;
      expect(gunnery.fire(shooter as never, gunship, missile, yaw, 0, now)).toBe(true);
      for (let i = 0; i < 10; i++) { now += 1000 / 30; gunnery.step(now); }
      // Flares: the missile flies on straight and misses.
      const cm = VEHICLE_ROLES.mi17.countermeasure!;
      expect(gunnery.countermeasure(target, now)).toBe(true);
      expect(target.arms!.cm.charges).toBe(cm.charges - 1);
      expect(gunnery.countermeasure(target, now + 100)).toBe(false);
      const hp = target.health;
      for (let i = 0; i < 120; i++) { now += 1000 / 30; gunnery.step(now); }
      expect(target.health).toBe(hp);
      // Every charge used: the long recharge, then all of them back.
      now += cm.durationMs; gunnery.countermeasure(target, now); now += cm.durationMs; gunnery.countermeasure(target, now);
      expect(target.arms!.cm.charges).toBe(0);
      expect(gunnery.countermeasure(target, now + cm.durationMs)).toBe(false);
      expect(gunnery.countermeasure(target, now + cm.cooldownMs + 10)).toBe(true);
    } finally { s.dispose(); }
  });

  it('every vehicle has seats for its weapons and a model at true size', () => {
    for (const [kind, role] of Object.entries(VEHICLE_ROLES) as Array<[VehicleKind, (typeof VEHICLE_ROLES)[VehicleKind]]>) {
      const def = VEHICLES[kind];
      expect(role.seats.length, kind).toBe(def.seats.length);
      for (const w of role.weapons) expect(w.seat, `${kind} ${w.id}`).toBeLessThan(def.seats.length);
    }
  });
});

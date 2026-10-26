import { describe, expect, it } from 'vitest';
import { DEFAULT_HOLD, WeaponDynamics, actionForSound, handImpulse, weaponBody } from './weapon-dynamics';

const peak = (d: WeaponDynamics, seconds: number, read: (d: WeaponDynamics) => number) => {
  let best = 0;
  for (let t = 0; t < seconds; t += 1 / 120) { d.step(1 / 120); best = Math.max(best, Math.abs(read(d))); }
  return best;
};

describe('weapon dynamics (hands as springs, gun as a rigid body)', () => {
  it('the same slap jolts a light pistol more than a rifle, and a rifle more than a machine gun', () => {
    const lift: number[] = [];
    for (const [mass, kind] of [[.9, 'pistol'], [3.8, 'rifle'], [15, 'heavy']] as const) {
      const d = new WeaponDynamics(weaponBody(mass, kind));
      d.impulse([0, 1.5, 0], [0, -.04, -.1]);
      lift.push(peak(d, .4, (g) => g.p[1]!));
    }
    expect(lift[0]).toBeGreaterThan(lift[1]!);
    expect(lift[1]).toBeGreaterThan(lift[2]!);
  });

  it('a pull on a side-mounted handle turns the gun towards that side; a centred pull does not', () => {
    const roll = (side: number) => {
      const b = weaponBody(3.8, 'rifle'), d = new WeaponDynamics(b), { j, at } = handImpulse('rack', b, side);
      d.impulse(j, at);
      d.step(1 / 30);
      return d.r[1]!;
    };
    expect(Math.sign(roll(1))).toBe(-Math.sign(roll(-1)));
    expect(Math.abs(roll(1))).toBeGreaterThan(1e-3);
    expect(Math.abs(roll(0))).toBeLessThan(1e-9);
  });

  it('oscillation dies away with damping, slower for a heavy gun', () => {
    const settle = (mass: number, kind: 'pistol' | 'heavy') => {
      const d = new WeaponDynamics(weaponBody(mass, kind));
      d.impulse([0, 1.5, .5], [0, -.04, -.1]);
      let last = d.energy(), t = 0;
      while (d.energy() > last * 1e-4 && t < 3) {
        const before = d.energy();
        d.step(1 / 60); t += 1 / 60;
        expect(d.energy()).toBeLessThanOrEqual(before + 1e-12);
      }
      last = d.energy();
      return t;
    };
    const pistol = settle(.9, 'pistol'), mg = settle(15, 'heavy');
    expect(pistol).toBeLessThan(1);
    expect(mg).toBeGreaterThan(pistol);
  });

  it('plays the same at 30, 60 and 144 frames per second', () => {
    const at = (fps: number) => {
      const d = new WeaponDynamics(weaponBody(3.1, 'rifle'));
      d.impulse([0, 1.4, -.2], [0, -.04, -.11]);
      for (let i = 0; i < fps / 2; i++) d.step(1 / fps);
      return [...d.p, ...d.r];
    };
    const a = at(30), b = at(60), c = at(144);
    for (let i = 0; i < 6; i++) { expect(a[i]).toBeCloseTo(b[i]!, 4); expect(c[i]).toBeCloseTo(b[i]!, 4); }
  });

  it('never moves the gun out of the hands, however hard the hit', () => {
    const d = new WeaponDynamics(weaponBody(.9, 'pistol'));
    d.impulse([40, 40, 40], [.05, .05, -.1]);
    for (let i = 0; i < 120; i++) {
      d.step(1 / 120);
      for (const v of d.p) expect(Math.abs(v)).toBeLessThanOrEqual(DEFAULT_HOLD.maxOffset + 1e-9);
      for (const v of d.r) expect(Math.abs(v)).toBeLessThanOrEqual(DEFAULT_HOLD.maxAngle + 1e-9);
    }
  });

  it('reads reload sounds as the hand actions that make them', () => {
    expect(actionForSound('ak_magout')).toBe('magOut');
    expect(actionForSound('M4_MagIn_Slap')).toBe('magIn');
    expect(actionForSound('charging_pull')).toBe('rack');
    expect(actionForSound('bolt_release')).toBe('release');
    expect(actionForSound('casing_drop')).toBeNull();
  });
});

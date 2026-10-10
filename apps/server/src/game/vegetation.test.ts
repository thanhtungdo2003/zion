import { describe, expect, it } from 'vitest';
import { VegetationDamage, type VegetationWorld } from './vegetation';

const flat: VegetationWorld = { ground: () => 0, visible: () => true };
const cells = (damage: VegetationDamage) => damage.sync(0, 0, 2, new Map(), true)!.chunks.flatMap((chunk) =>
  chunk.cells.map((cell) => ({ x: chunk.cx * 32 + cell[0] + 0.5, z: chunk.cz * 32 + cell[1] + 0.5, fire: cell[3] })));

describe('ground-cover damage and random regrowth', () => {
  it('blasts cross chunk boundaries and cannot destroy ground from an airburst above its radius', () => {
    const damage = new VegetationDamage(flat);
    damage.explode(32, 0.3, 16, 3, 0);
    const hit = cells(damage);
    expect(hit.some((cell) => cell.x < 32)).toBe(true);
    expect(hit.some((cell) => cell.x > 32)).toBe(true);
    expect(hit.every((cell) => Math.hypot(cell.x - 32, cell.z - 16) <= 3)).toBe(true);
    const airborne = new VegetationDamage(flat);
    airborne.explode(16, 12, 16, 3, 0);
    expect(cells(airborne)).toHaveLength(0);
  });

  it('fire affects only the forward cone and stops at cover', () => {
    const damage = new VegetationDamage({ ...flat, visible: (_ox, _oy, _oz, x) => x < 20 });
    damage.burn(16, 1.3, 16, 1, 0, 8, 0.3, 4, 1000);
    const hit = cells(damage);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((cell) => cell.x > 16 && cell.x < 20 && Math.abs(cell.z - 16) < 3)).toBe(true);
    expect(hit.every((cell) => cell.fire === 5000)).toBe(true);
  });

  it('ignores submerged or unavailable ground, cliffs above the flame and blocked blasts', () => {
    const absent = new VegetationDamage({ ...flat, ground: () => NaN });
    absent.explode(16, 0, 16, 3, 0);
    expect(cells(absent)).toHaveLength(0);
    const cliff = new VegetationDamage({ ...flat, ground: () => 10 });
    cliff.burn(16, 1.3, 16, 1, 0, 8, 0.3, 4, 0);
    expect(cells(cliff)).toHaveLength(0);
    const cover = new VegetationDamage({ ...flat, visible: () => false });
    cover.explode(16, 0, 16, 3, 0);
    expect(cells(cover)).toHaveLength(0);
  });

  it('waits for cooldown, pauses at speed zero and regrows faster at higher speed', () => {
    const slow = new VegetationDamage(flat, () => 0.01);
    const fast = new VegetationDamage(flat, () => 0.01);
    for (const damage of [slow, fast]) {
      damage.explode(16, 0.3, 16, 2, 0);
      damage.step(14_999, 1, 1000);
      expect(cells(damage).length).toBeGreaterThan(0);
      damage.step(16_000, 1, 0);
      expect(cells(damage).length).toBeGreaterThan(0);
    }
    slow.step(17_000, 1, 1);
    fast.step(17_000, 1, 3);
    expect(cells(slow).length).toBeGreaterThan(0);
    expect(cells(fast)).toHaveLength(0);
  });

  it('repeated fire postpones regrowth and never regrows during a long burn', () => {
    const damage = new VegetationDamage(flat, () => 0);
    damage.burn(16, 1.3, 16, 1, 0, 4, 0.3, 30, 0);
    damage.step(20_000, 1, 3);
    expect(cells(damage).length).toBeGreaterThan(0);
    damage.burn(16, 1.3, 16, 1, 0, 4, 0.3, 4, 29_000);
    damage.step(34_000, 1, 3);
    expect(cells(damage).length).toBeGreaterThan(0);
    damage.step(44_000, 1, 3);
    expect(cells(damage)).toHaveLength(0);
  });

  it('syncs changes once, sends restoration and restores damage on re-entering or joining', () => {
    const damage = new VegetationDamage(flat, () => 0);
    const known = new Map<number, number>();
    damage.explode(16, 0.3, 16, 2, 0);
    const joined = damage.sync(0, 0, 2, known, true)!;
    expect(joined.chunks[0]!.cells.length).toBeGreaterThan(0);
    expect(damage.sync(0, 0, 2, known, false)).toBeNull();
    expect(damage.sync(100, 100, 2, known, true)!.chunks).toHaveLength(0);
    expect(damage.sync(0, 0, 2, known, true)!.chunks).toEqual(joined.chunks);
    damage.step(16_000, 1, 3);
    expect(damage.sync(0, 0, 2, known, false)!.chunks).toEqual([{ cx: 0, cz: 0, cells: [] }]);
    expect(damage.sync(0, 0, 2, known, false)).toBeNull();
  });
});

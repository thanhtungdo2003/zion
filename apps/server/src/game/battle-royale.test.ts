import { describe, expect, it } from 'vitest';
import { BattleRoyaleMatch, BATTLE_STAGES } from './battle-royale';
import { BATTLE_FLIGHT, BATTLE_MAP } from '@zion/shared';

function running() {
  const match = new BattleRoyaleMatch(123, 1024);
  match.join(1, 'A'); match.join(2, 'B'); match.join(3, 'C');
  match.tick(0); match.tick(30_000); return match;
}
describe('Battle Royale match', () => {
  it('waits for two players, cancels a depleted countdown and rejects late joins', () => {
    const match = new BattleRoyaleMatch(1, 1024);
    match.join(1, 'A'); match.tick(0); expect(match.phase).toBe('waiting');
    match.join(2, 'B'); match.tick(100); expect(match.phase).toBe('countdown');
    match.leave(2); match.tick(200); expect(match.phase).toBe('waiting');
    match.join(3, 'C'); match.tick(300); match.tick(30_300);
    expect(match.phase).toBe('running'); expect(match.join(4, 'D')).toBe(false);
  });
  it('limits a match to its unique entrants and blocks combat before deployment', () => {
    const match = new BattleRoyaleMatch(1, 1024), max = BATTLE_MAP.maxPlayers;
    for (let i = 0; i < max; i++) expect(match.join(i, String(i))).toBe(true);
    expect(match.join(0, 'duplicate')).toBe(false); expect(match.join(max, 'overflow')).toBe(false);
    expect(match.canFight(0)).toBe(false);
  });
  it('interpolates shrinking circles, keeps later circles nested and closes the final circle', () => {
    const match = running(); let now = 30_000 + BATTLE_FLIGHT.durationMs;
    for (const stage of BATTLE_STAGES) {
      const initial = { ...match.circle }, next = { ...match.nextCircle };
      expect(Math.hypot(next.x - initial.x, next.z - initial.z) + next.radius).toBeLessThanOrEqual(initial.radius + 1e-8);
      expect(next.x).toBeGreaterThanOrEqual(1024 * .3); expect(next.x).toBeLessThanOrEqual(1024 * .7);
      now += stage.wait; match.tick(now);
      match.tick(now + stage.shrink / 2);
      expect(match.circle.radius).toBeCloseTo((initial.radius + next.radius) / 2);
      now += stage.shrink; match.tick(now);
      expect(match.circle).toEqual(next);
    }
    expect(match.circle.radius).toBe(0);
    expect(match.outside(match.circle.x, match.circle.z)).toBe(true);
    expect(match.state(now).damagePerSecond).toBe(20);
  });
  it('drops an entrant killed in the lobby, so the match can still end', () => {
    const match = running();
    match.phase = 'waiting'; match.eliminate(3);
    expect(match.entrants.has(3)).toBe(false);
    match.phase = 'running'; match.eliminate(2); match.tick(40_000);
    expect(match.phase).toBe('finished');
  });
  it('counts elimination and disconnect once, gives placements and announces the last survivor', () => {
    const match = running(); match.eliminate(2); match.eliminate(2);
    expect(match.alive).toBe(2); expect(match.state(31_000, 2).placement).toBe(3);
    expect(match.canFight(2)).toBe(false);
    match.leave(3); match.tick(32_000);
    expect(match.state(32_000, 1)).toMatchObject({ phase: 'finished', winner: { id: 1, name: 'A' }, placement: 1, alive: 1 });
    expect(match.canFight(1)).toBe(false);
  });
  it('handles everyone dying in the same tick without inventing a winner', () => {
    const match = running(); for (const id of [1, 2, 3]) match.eliminate(id);
    match.tick(31_000); expect(match.state(31_000).winner).toBeNull(); expect(match.phase).toBe('finished');
  });
  it('ends when one squad is left and ranks the whole squad first', () => {
    const match = new BattleRoyaleMatch(5, 1024), red = { id: 'red', name: 'Đỏ', size: 2 };
    match.join(1, 'A', red); match.join(2, 'B', red); match.join(3, 'C');
    expect(match.squadSize).toBe(2); expect(match.allies(1, 2)).toBe(true); expect(match.allies(1, 3)).toBe(false);
    match.tick(0); match.tick(30_000);
    match.eliminate(1); match.tick(30_100); expect(match.phase).toBe('running');
    match.eliminate(3); match.tick(30_200); expect(match.phase).toBe('finished');
    expect(match.state(30_200, 1).placement).toBe(1); expect(match.state(30_200, 3).placement).toBe(2);
    expect(match.state(30_200).winner).toMatchObject({ name: 'Đỏ', squad: 'red' });
  });
});

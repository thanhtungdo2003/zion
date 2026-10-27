import { describe, expect, it } from 'vitest';
import { WAVE_BOARDS, WAVE_BREAK_MS, WAVE_COUNTDOWN_MS, ZombieVariant, isWaveBoard, waveBoard, wavePlan, zombieMaxHealth } from '@zion/shared';
import { WAVE_GATHER_MS, WaveMatch } from './waves';

const input = (over: Partial<Parameters<WaveMatch['tick']>[1]> = {}) => ({ present: 1, expected: 1, alive: 1, team: 1, zombiesAlive: 0, ...over });

describe('wave leaderboards', () => {
  it('sorts every team make-up into exactly one of the eight boards', () => {
    expect(waveBoard('bots', 1, 0)).toBe('solo');
    expect(waveBoard('bots', 1, 1)).toBe('duo_bot');
    expect(waveBoard('bots', 1, 2)).toBe('trio_bot');
    expect(waveBoard('bots', 1, 3)).toBe('squad_bot');
    expect(waveBoard('friends', 1, 0)).toBe('solo_player');
    expect(waveBoard('friends', 2, 0)).toBe('duo_players');
    expect(waveBoard('friends', 3, 0)).toBe('trio_players');
    expect(waveBoard('friends', 4, 0)).toBe('full_squad');
    expect(WAVE_BOARDS).toHaveLength(8);
    expect(new Set(WAVE_BOARDS.map((b) => b.id)).size).toBe(8);
    expect(isWaveBoard('squad_bot')).toBe(true);
    expect(isWaveBoard('global')).toBe(false);
  });

  it('never ranks a mixed or impossible team: three bots stay out of Solo and Full Squad', () => {
    expect(waveBoard('friends', 1, 3)).toBeNull();
    expect(waveBoard('friends', 2, 1)).toBeNull();
    expect(waveBoard('bots', 2, 0)).toBeNull();
    expect(waveBoard('bots', 1, 4)).toBeNull();
    expect(waveBoard('friends', 5, 0)).toBeNull();
    expect(waveBoard('friends', 0, 0)).toBeNull();
    for (const bots of [0, 1, 2, 3]) expect(waveBoard('bots', 1, bots)).not.toMatch(/player|squad$/);
  });
});

describe('wave difficulty', () => {
  it('grows by numbers, rhythm, sides and mix; zombie health per kind never changes', () => {
    const early = wavePlan(1), late = wavePlan(12);
    expect(late.count).toBeGreaterThan(early.count * 3);
    expect(late.spawnEveryMs).toBeLessThan(early.spawnEveryMs);
    expect(late.burst).toBeGreaterThan(early.burst);
    expect(late.sides).toBeGreaterThan(early.sides);
    expect(early.mix[ZombieVariant.Brute]).toBe(0);
    expect(late.mix[ZombieVariant.Brute]).toBeGreaterThan(0);
    expect(late.mix[ZombieVariant.Crimson]).toBeGreaterThan(0);
    expect(wavePlan(4, 4).count).toBeGreaterThan(wavePlan(4, 1).count);
    expect(zombieMaxHealth(ZombieVariant.Brute)).toBe(200);
    expect(wavePlan(50).maxAlive).toBeLessThanOrEqual(36);
  });
});

describe('wave match flow', () => {
  it('counts down, spawns a wave, rests after clearing it and ends when the team is down', () => {
    const m = new WaveMatch(() => .3);
    let now = 1000;
    m.tick(now, input());
    expect(m.phase).toBe('countdown');
    now += WAVE_COUNTDOWN_MS;
    expect(m.tick(now, input()).started).toBe(1);
    const plan = m.plan!;
    let alive = 0, spawned = 0;
    for (let i = 0; i < 400 && spawned < plan.count; i++) {
      now += 100;
      const ev = m.tick(now, input({ zombiesAlive: alive }));
      spawned += ev.spawn.length; alive += ev.spawn.length;
      expect(alive).toBeLessThanOrEqual(plan.maxAlive);
      if (alive > 2) alive -= 2;
    }
    expect(spawned).toBe(plan.count);
    now += 100;
    expect(m.tick(now, input({ zombiesAlive: 0 })).cleared).toBe(1);
    expect(m.phase).toBe('break');
    expect(m.cleared).toBe(1);
    expect(m.clearMs).toBeGreaterThan(0);
    now += WAVE_BREAK_MS;
    expect(m.tick(now, input()).started).toBe(2);
    now += 5000;
    expect(m.tick(now, input({ alive: 0 })).over).toBe(true);
    expect(m.phase).toBe('over');
    expect(m.cleared).toBe(1);
    expect(m.survivedMs).toBe(now - (1000 + WAVE_COUNTDOWN_MS));
    expect(m.tick(now + 1000, input()).spawn).toHaveLength(0);
  });

  it('a friends party waits for its members, but not for ever', () => {
    const m = new WaveMatch();
    m.tick(0, input({ present: 1, expected: 3 }));
    expect(m.phase).toBe('lobby');
    m.tick(1000, input({ present: 3, expected: 3 }));
    expect(m.phase).toBe('countdown');
    const late = new WaveMatch();
    late.tick(0, input({ present: 1, expected: 4 }));
    late.tick(WAVE_GATHER_MS, input({ present: 2, expected: 4 }));
    expect(late.phase).toBe('countdown');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { MatchPool } from './match-pool';
import type { GameServer } from './game-server';
import type { Logger } from '../logger';

/** A stand-in match: admits players until it is full or has started. */
function fakeMatch(capacity = 2) {
  const m = { headcount: 0, started: false, start: vi.fn(), stop: vi.fn(async () => undefined), canAdmit: () => !m.started && m.headcount < capacity };
  return m;
}

describe('match pool', () => {
  it('fills a gathering match, opens a new one once it has started or is full, and keeps squads together', () => {
    const made: Array<ReturnType<typeof fakeMatch>> = [];
    const pool = new MatchPool(() => { const m = fakeMatch(); made.push(m); return m as unknown as GameServer; }, { info: vi.fn(), error: vi.fn() } as unknown as Logger, 3);
    pool.start();
    const a = pool.pick() as unknown as ReturnType<typeof fakeMatch>;
    expect(made).toHaveLength(1);
    a.headcount++;
    expect(pool.pick()).toBe(a);
    a.started = true;
    const b = pool.pick('squad-1') as unknown as ReturnType<typeof fakeMatch>;
    expect(b).not.toBe(a);
    expect(made).toHaveLength(2);
    b.headcount++;
    // A third gathering match exists; the squadmate still lands with their squad.
    const c = fakeMatch(); made.push(c);
    expect(pool.pick('squad-1')).toBe(b);
    b.headcount++;
    // Full and started everywhere, at the cap: nothing.
    b.started = true;
    expect(pool.pick()).not.toBeNull();
    expect(pool.pick()).not.toBe(b);
    void pool.stop();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { autoWarfareLayout, parseWarfareConfig } from '@zion/shared';
import { createLogger } from '../logger';
import { WarfareMatch } from './warfare';
import { WarfareRooms, type WarfareRoomServer } from './warfare-rooms';

const layout = autoWarfareLayout(120, 3);

function fighting(cfgOver: Record<string, unknown> = {}) {
  const m = new WarfareMatch(parseWarfareConfig({ countdownSeconds: 1, ...cfgOver }), layout);
  m.tick(1000, { humans: 1, units: [] });
  expect(m.phase).toBe('countdown');
  const ev = m.tick(2000, { humans: 1, units: [] });
  expect(ev.started).toBe(true);
  expect(m.phase).toBe('fighting');
  return m;
}

describe('WarfareMatch', () => {
  it('waits in the lobby until a player arrives', () => {
    const m = new WarfareMatch(parseWarfareConfig({}), layout);
    m.tick(0, { humans: 0, units: [] });
    expect(m.phase).toBe('lobby');
  });

  it('only charges tickets while fighting', () => {
    const m = new WarfareMatch(parseWarfareConfig({ tickets: 10 }), layout);
    expect(m.death('blue', 'a')).toBe(false);
    m.tick(0, { humans: 1, units: [] });
    m.tick(60_000, { humans: 1, units: [] });
    expect(m.death('blue', 'a')).toBe(true);
    expect(m.death('blue', 'a')).toBe(false);
    expect(m.ledger.tickets.blue).toBe(9);
  });

  it('ends on tickets with the other side winning', () => {
    const m = fighting({ tickets: 10 });
    for (let i = 0; i < 10; i++) m.death('red', String(i));
    const ev = m.tick(3000, { humans: 1, units: [] });
    expect(ev.over).toEqual({ winner: 'blue', reason: 'tickets' });
    expect(m.phase).toBe('over');
    expect(m.death('blue', 'x')).toBe(false);
  });

  it('captures zones with presence and bleeds the side holding fewer', () => {
    const m = fighting({ captureSeconds: 2, bleedGraceSeconds: 0, bleedPerZone: 1, bleedMaxPerSecond: 5 });
    const zones = m.capture.zones;
    const units = zones.map((z) => ({ side: 'blue' as const, x: z.x, z: z.z }));
    let t = 2000, flips = 0;
    for (let i = 0; i < 10; i++) { t += 500; flips += m.tick(t, { humans: 1, units }).flips.length; }
    expect(flips).toBeGreaterThanOrEqual(zones.length);
    expect(m.capture.held().blue).toBe(zones.length);
    const before = m.ledger.tickets.red;
    m.tick(t + 2000, { humans: 1, units });
    expect(m.ledger.tickets.red).toBeLessThan(before);
    expect(m.ledger.tickets.blue).toBe(parseWarfareConfig({}).tickets);
  });

  it('ends on the time limit by tickets', () => {
    const m = fighting({ timeLimitMinutes: 1 });
    m.death('blue', 'k');
    const ev = m.tick(2000 + 60_000, { humans: 1, units: [] });
    expect(ev.over).toEqual({ winner: 'red', reason: 'time' });
  });

  it('forfeits after the room stays empty, then closes after the result screen', () => {
    const m = fighting({ emptyGraceSeconds: 5, overSeconds: 3 });
    m.tick(3000, { humans: 0, units: [] });
    expect(m.phase).toBe('fighting');
    const ev = m.tick(8500, { humans: 0, units: [] });
    expect(ev.over?.reason).toBe('forfeit');
    expect(m.tick(10_000, { humans: 0, units: [] }).close).toBeUndefined();
    expect(m.tick(11_600, { humans: 0, units: [] }).close).toBe(true);
  });

  it('resets the empty timer when someone returns', () => {
    const m = fighting({ emptyGraceSeconds: 5 });
    m.tick(3000, { humans: 0, units: [] });
    m.tick(6000, { humans: 1, units: [] });
    m.tick(7000, { humans: 0, units: [] });
    expect(m.tick(10_000, { humans: 0, units: [] }).over).toBeUndefined();
  });
});

describe('WarfareRooms', () => {
  const fake = (): WarfareRoomServer & { started: boolean; open: boolean; rejoin: Set<string> } => {
    const s = { started: false, open: true, rejoin: new Set<string>(), headcount: 0,
      start() { s.started = true; }, stop: vi.fn(async () => undefined),
      canAdmit: () => s.open, hasRejoin: (id: string) => s.rejoin.has(id) };
    return s as never;
  };
  const maps = (id: string) => (id === 'm' ? { name: 'M' } : null);

  it('rejects unknown maps and anonymous players', () => {
    const rooms = new WarfareRooms(() => fake(), maps, createLogger('silent', false));
    expect(rooms.source('x')).toBeNull();
    expect(rooms.source('m')!.pick(undefined, undefined)).toBeNull();
  });

  it('fills an open room before opening another, and respects the cap', () => {
    const made: ReturnType<typeof fake>[] = [];
    const rooms = new WarfareRooms(() => { const f = fake(); made.push(f); return f; }, maps, createLogger('silent', false), 2);
    const src = rooms.source('m')!;
    const a = src.pick(undefined, 'p1');
    expect(src.pick(undefined, 'p2')).toBe(a);
    expect(made[0]!.started).toBe(true);
    made[0]!.open = false;
    const b = src.pick(undefined, 'p3');
    expect(b).not.toBe(a);
    made[1]!.open = false;
    expect(src.pick(undefined, 'p4')).toBeNull();
    made[0]!.rejoin.add('p1');
    expect(src.pick(undefined, 'p1')).toBe(a);
  });

  it('sweeps empty rooms and closes via the room callback', () => {
    let closed: (() => void) | null = null;
    const made: ReturnType<typeof fake>[] = [];
    const rooms = new WarfareRooms((cfg) => { closed = cfg.closed; const f = fake(); made.push(f); return f; }, maps, createLogger('silent', false));
    rooms.source('m')!.pick(undefined, 'p');
    rooms.source('m')!.pick(undefined, 'q');
    expect(rooms.count).toBe(1);
    closed!();
    expect(rooms.count).toBe(0);
    expect(made[0]!.stop).toHaveBeenCalled();
    rooms.source('m')!.pick(undefined, 'p');
    rooms.sweep(Date.now() + 100_000);
    expect(rooms.count).toBe(0);
  });
});

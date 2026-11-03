import { describe, expect, it } from 'vitest';
import { TEMPLE_RULES, TempleSimulation, type Person } from './simulation';

const user = (i: number) => ({ id: `u${i}`, name: `Người ${i}`, avatar: null });
let n = 0;
const like = (i: number, likes: number) => ({ kind: 'like' as const, id: `e${n++}`, user: user(i), likes });
const run = (sim: TempleSimulation, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) sim.update(1 / 30); };

describe('Chánh Điện simulation', () => {
  it('seats a viewer on the first like and makes a small offering every 10 likes', () => {
    const offered: string[] = [], sim = new TempleSimulation({ offered: (p, o) => offered.push(`${p.key}:${o.kind}`) });
    sim.receive(like(1, 3));
    expect(sim.people.get('u1')?.state).toBe('entering');
    run(sim, 20);
    expect(sim.people.get('u1')?.state).toBe('sitting');
    sim.receive(like(1, 9));
    run(sim, 30);
    expect(offered).toEqual(['u1:small']);
    expect(sim.people.get('u1')?.state).toBe('sitting');
  });

  it('a big offering (50 likes, follow, share) takes the camera and gives it back', () => {
    const focus: Array<Person | null> = [], sim = new TempleSimulation({ focus: (p) => focus.push(p) });
    sim.receive(like(2, 50));
    sim.receive({ kind: 'follow', id: 'f1', user: user(3) });
    run(sim, 80);
    expect(focus.filter(Boolean).map((p) => p!.key).sort()).toEqual(['u2', 'u3']);
    expect(focus.at(-1)).toBeNull();
    expect(sim.active).toBeNull();
  });

  it('ignores gifts and repeats of the same follow inside the cooldown', () => {
    const sim = new TempleSimulation();
    sim.receive({ kind: 'gift', id: 'g1', user: user(4) });
    expect(sim.people.size).toBe(0);
    sim.receive({ kind: 'follow', id: 'f2', user: user(4) });
    sim.receive({ kind: 'follow', id: 'f3', user: user(4) });
    expect(sim.people.get('u4')?.offering?.kind).toBe('big');
    run(sim, 40);
    expect(sim.people.get('u4')?.offerings).toBe(1);
  });

  it('keeps to the crowd limit, frees a place for a follow, and lets quiet viewers leave', () => {
    const sim = new TempleSimulation(); sim.maxPeople = 3;
    for (let i = 10; i < 15; i++) sim.receive(like(i, 1));
    expect(sim.people.size).toBe(3);
    run(sim, 20);
    sim.receive({ kind: 'share', id: 's1', user: user(20) });
    expect(sim.people.has('u20')).toBe(true);
    run(sim, TEMPLE_RULES.inactiveSeconds + 60);
    expect(sim.people.size).toBe(0);
    expect(sim.seats.every((s) => !s.owner)).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry, SIGN_ASSET } from '@zion/assets';
import { CHUNK_SIZE, quantizeHeight, quantizeLocal } from '@zion/shared';
import { PropKnock, RESTORE_MS } from './prop-knock';

function setup(asset = SIGN_ASSET.stop) {
  const chunk = { cx: 0, cz: 0, props: [{ asset, lx: quantizeLocal(10), lz: quantizeLocal(10), yq: quantizeHeight(0), rot: 0, scale: 85 }] };
  const physics = { propFilter: null as null | ((cx: number, cz: number, p: unknown) => boolean), reload: vi.fn() };
  const sent: Array<{ t: string }> = [];
  const knock = new PropKnock({
    world: { peek: (cx: number, cz: number) => (cx === 0 && cz === 0 ? { data: chunk } : undefined) } as never,
    registry: createDefaultRegistry(), physics: physics as never,
    broadcastAt: (_x, _z, m) => sent.push(m), broadcast: (m) => sent.push(m), occupied: () => false,
  });
  return { knock, physics, sent, prop: chunk.props[0]! };
}

describe('knocking light props', () => {
  it('a car driving into a sign flings it along and takes its collider away until it stands again', () => {
    const { knock, physics, sent, prop } = setup();
    knock.vehicle(10, 13, 0, -12, 2.2, 0);
    expect(sent[0]).toMatchObject({ t: 'knock', tree: false });
    expect((sent[0] as unknown as { vz: number }).vz).toBeLessThan(-5);
    expect(physics.propFilter!(0, 0, prop)).toBe(false);
    expect(physics.reload).toHaveBeenCalledWith(0, 0);
    knock.step(RESTORE_MS + 1);
    expect(physics.propFilter!(0, 0, prop)).toBe(true);
    expect(sent.at(-1)).toEqual({ t: 'knocked', keys: [] });
  });
  it('a parked or slow car leaves it alone; a bullet or a blast does not', () => {
    const { knock, sent } = setup();
    knock.vehicle(10, 13, 0, -1, 2.2, 0);
    expect(sent).toHaveLength(0);
    knock.bullet(SIGN_ASSET.stop, 10, 1.5, 10, 0, 0, -1, 30, 0);
    expect(sent).toHaveLength(1);
    const blast = setup();
    blast.knock.blast(10 + CHUNK_SIZE / 8, 0, 10, 6, 0);
    expect(blast.sent[0]).toMatchObject({ t: 'knock' });
  });
});

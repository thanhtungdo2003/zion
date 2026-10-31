import { describe, expect, it } from 'vitest';
import type { ChunkData } from '@zion/shared';
import { createDefaultRegistry } from './builtin';
import { chunkStudioDoors, inStudioDoorSwing, studioDoorColliders, STUDIO_DOOR_ID_BASE } from './studio-doors';

describe('Model Studio house doors in game', () => {
  const registry = createDefaultRegistry();
  const base = registry.byNumericId(2402)!;
  registry.registerUploaded({ ...structuredClone(base), id: 'studio.model_3005', numericId: 3005, name: 'house', tags: ['model-studio'], doors: [{ x: 1, y: 0, z: 2, yaw: 0, w: .9, h: 2.05, color: '#704020' }] } as never);
  const chunk = (yaw: number) => ({ cx: 1, cz: 1, props: [{ asset: 3005, lx: 20000, lz: 20000, yq: 400, rot: yaw, scale: 85 }] }) as unknown as ChunkData;

  it('finds each placed house\'s doors where the house stands, with an id every client agrees on', () => {
    const [a] = chunkStudioDoors(chunk(0), registry), [b] = chunkStudioDoors(chunk(0), registry);
    expect(a).toBeDefined();
    expect(a!.id).toBe(b!.id);
    expect(a!.id).toBeGreaterThanOrEqual(STUDIO_DOOR_ID_BASE);
    expect(a!.w).toBeCloseTo(.9, 1); expect(a!.color).toBe('#704020');
    const turned = chunkStudioDoors(chunk(64), registry)[0]!;
    expect(turned.id).not.toBe(a!.id);
    expect(turned.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('closes across the doorway and swings a quarter turn open', () => {
    const d = { id: 1, x: 0, y: 0, z: 0, yaw: 0, w: 1, h: 2 };
    const closed = studioDoorColliders(d, false)[0]!.shape as { cx: number; cz: number }, open = studioDoorColliders(d, true)[0]!.shape as { cx: number; cz: number };
    expect(closed.cx).toBeCloseTo(.5); expect(closed.cz).toBeCloseTo(0);
    expect(open.cx).toBeCloseTo(0); expect(open.cz).toBeCloseTo(-.5);
    expect(inStudioDoorSwing(d, .5, -.4)).toBe(true);
    expect(inStudioDoorSwing(d, 3, 0)).toBe(false);
  });
});

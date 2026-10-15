import { describe, expect, it } from 'vitest';
import { validateModel } from './custom-weapons';

describe('Studio weapon model validation', () => {
  it('accepts a GLB header and a Blockbench model, rejects anything else', () => {
    const glb = Buffer.alloc(20); glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4);
    expect(() => validateModel(glb, 'glb')).not.toThrow();
    expect(() => validateModel(Buffer.from('not a glb at all......'), 'glb')).toThrow();
    expect(() => validateModel(Buffer.from(JSON.stringify({ elements: [], outliner: [], resolution: { width: 16, height: 16 } })), 'bbmodel')).not.toThrow();
    expect(() => validateModel(Buffer.from('{"elements": 3}'), 'bbmodel')).toThrow();
    expect(() => validateModel(Buffer.from('<html>'), 'bbmodel')).toThrow();
  });
});

describe('Studio weapon saving', () => {
  it('accepts a definition sent back with its listing fields (modelUrl)', async () => {
    const { CustomWeaponStore } = await import('./custom-weapons');
    const { builtinWeaponDraft, unregisterCustomWeapon } = await import('@zion/shared');
    const db = { query: async () => ({ rows: [{ updated_at: new Date() }] }) };
    const store = new CustomWeaponStore(db as never);
    const draft = builtinWeaponDraft('m4a1', { length: .9, barrel: [0, 1, 0], up: [0, 0, 1], grip: [0, .5, -3.5], muzzle: [0, 34, 1], rail: [0, 6, 4] }, 'bbmodel', 1)!;
    const saved = await store.save({ ...draft, modelUrl: '/api/weapons/m4a1/model?v=1' }, null, null);
    expect(saved.def.id).toBe('m4a1');
    unregisterCustomWeapon('m4a1');
  });
});

import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { Scene, type Group } from 'three';
import { EntityFlags } from '@zion/shared';
import { BattleFlightRenderer } from './battle-flight';
import { Avatar } from './avatars';
import { buildBBModel, type RawModel } from './character-model';
import type * as CharacterModel from './character-model';

vi.mock('./character-model', async original => {
  const mod = await original<typeof CharacterModel>();
  return { ...mod, loadCharacterModel: async (url: string) => {
    const raw = JSON.parse(await readFile(new URL(`../../../public${url}`, import.meta.url), 'utf8')) as RawModel;
    raw.textures = []; return mod.buildBBModel(raw);
  } };
});
// The transport plane is a textured GLB (no image decoding here): a stand-in group.
vi.mock('./transport-plane', async () => {
  const three = await import('three');
  return { loadTransportPlane: async () => ({ root: new three.Group(), boneNames: [], clips: new Map() }) };
});
describe('Battle Royale animated models', () => {
  it('plays supplied door clips, inflates a canopy and cleans up on landing', async () => {
    const scene = new Scene(), renderer = new BattleFlightRenderer(scene); await renderer.load();
    const state = { t: 'door' as const, id: 1, x: 10, y: 0, z: 10, yaw: 0, open: false };
    renderer.door(state); renderer.update(.1, .05, 10, 10, { x: 20, y: 650, z: 20, yaw: 0, remainingMs: 1000 });
    expect(scene.getObjectByName('door')!.rotation.y).toBeCloseTo(0);
    renderer.door({ ...state, open: true }); renderer.update(.1, .1, 10, 10, undefined);
    expect(scene.getObjectByName('door')!.rotation.y).toBeCloseTo(-Math.PI / 2);
    renderer.door(state); renderer.update(.1, .1, 10, 10, undefined);
    expect(scene.getObjectByName('door')!.rotation.y).toBeCloseTo(0);
    const internals = renderer as unknown as { canopies: Map<number, { root: Group }> };
    renderer.player(2, 10, 100, 10, 0, EntityFlags.Parachute, .1);
    const early = internals.canopies.get(2)!.root.scale.x;
    renderer.player(2, 10, 95, 10, 0, EntityFlags.Parachute, .8);
    expect(internals.canopies.get(2)!.root.scale.x).toBeGreaterThan(early);
    renderer.player(2, 10, 0, 10, 0, EntityFlags.Grounded, .1); expect(internals.canopies.size).toBe(0);
    renderer.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('keeps the falling character horizontal, steepens the dive and restores visibility after leaving the plane', async () => {
    const raw = JSON.parse(await readFile(new URL('../../../public/models/characters/teen-wasteland-survivor.bbmodel', import.meta.url), 'utf8')) as RawModel;
    raw.textures = [];
    const avatar = new Avatar(await buildBBModel(raw), true);
    avatar.flightPose(EntityFlags.InPlane, false, false, 1); expect(avatar.root.visible).toBe(false);
    avatar.flightPose(EntityFlags.Freefall, false, false, 1); expect(avatar.root.visible).toBe(true);
    const model = (avatar as unknown as { model: Group }).model;
    expect(model.rotation.x).toBeCloseTo(-Math.PI / 2, 2);
    avatar.flightPose(EntityFlags.Freefall, true, true, 1); expect(model.rotation.x).toBeLessThan(-2.4);
    avatar.flightPose(EntityFlags.Parachute, false, true, 1); expect(model.rotation.x).toBeCloseTo(-.12, 2);
    avatar.flightPose(EntityFlags.Grounded, false, false, 1); expect(model.rotation.x).toBeCloseTo(0, 2);
  });
});

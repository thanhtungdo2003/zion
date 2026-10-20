import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ARCHITECT_MODEL_URL, GUARD_MODEL_URL, MERCHANT_MODEL_URL, NURSE_MODEL_URL } from '@zion/shared';
import { buildBBModel, mirrorCharacter, type RawModel } from './character-model';
import { prepareGuardModel } from './guard-model';

async function load(url: string) {
  const raw = JSON.parse(await readFile(new URL(`../../../public${url}`, import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  return mirrorCharacter(await buildBBModel(raw));
}

describe('NPC rigs', () => {
  it.each([GUARD_MODEL_URL, MERCHANT_MODEL_URL, NURSE_MODEL_URL, ARCHITECT_MODEL_URL])('%s gets both hands', async (url) => {
    const survivor = await load('/models/characters/teen-wasteland-survivor.bbmodel');
    const npc = prepareGuardModel(await load(url), survivor);
    expect(npc.root.getObjectByName('hand_right')).toBeTruthy();
    expect(npc.root.getObjectByName('hand_left')).toBeTruthy();
  });
});

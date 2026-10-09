import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBBModel } from './apps/web/src/game/render/character-model.ts';
import { prepareGuardModel } from './apps/web/src/game/render/guard-model.ts';
import { Avatar } from './apps/web/src/game/render/avatars.ts';
import { loadWeapons } from './apps/web/src/game/render/weapons.ts';

async function raw(path) {
  const model = JSON.parse(await readFile(path, 'utf8'));
  model.textures = [];
  return model;
}
const survivor = await buildBBModel(await raw('models/characters/teen-wasteland-survivor.bbmodel'));
const soldier = prepareGuardModel(await buildBBModel(await raw('models/npcs/armored-soldier.bbmodel')), survivor);
globalThis.fetch = async url => new Response(JSON.stringify(await raw(String(url).slice(1))));
const weapons = await loadWeapons(survivor);
const avatar = new Avatar(soldier, false);
avatar.setWeapon('ak47', weapons);
avatar.setStance('rifle');
for (let i = 0; i < 4; i++) avatar.update(0, 0, 0, 0, 1, 0.25, 0);
avatar.root.updateMatrixWorld(true);
const muzzle = avatar.root.position.clone();
assert.ok(avatar.weaponPoint('muzzle', muzzle));
assert.ok(muzzle.z < -0.3 && muzzle.y > 0.8 && muzzle.y < 1.9, `bad AK placement: ${muzzle.toArray()}`);
assert.ok(avatar.root.getObjectByName('hand_right').children.length > 0);
console.log('Guard geometry, rifle idle, hand attachment and forward-facing AK muzzle verified:', muzzle.toArray());

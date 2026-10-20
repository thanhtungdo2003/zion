import type { CharacterTemplate } from './character-model';

/** The soldier shares the survivor's arm pivots, but its source lacks hand locators and idle. */
export function prepareGuardModel(soldier: CharacterTemplate, survivor: CharacterTemplate): CharacterTemplate {
  for (const side of ['right', 'left']) {
    const name = `hand_${side}`;
    const hand = survivor.root.getObjectByName(name);
    // Rigs name the arm arm_right, right_arm or arm_r.
    const arm = soldier.root.getObjectByName(`arm_${side}`) ?? soldier.root.getObjectByName(`${side}_arm`) ?? soldier.root.getObjectByName(`arm_${side[0]}`);
    if (!hand || !arm) throw new Error(`guard rig is missing ${name} or its arm`);
    if (!soldier.root.getObjectByName(name)) {
      arm.add(hand.clone(true));
      soldier.boneNames.push(name);
    }
  }
  const idle = survivor.clips.get('rifle_idle');
  if (!idle) throw new Error('guard requires rifle_idle');
  soldier.clips.set('rifle_idle', idle);
  return soldier;
}

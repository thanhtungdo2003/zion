import { Vector3, type Object3D } from 'three';
import { ARMOR_BY_ID } from '@zion/shared';
import { buildBBModel, mirrorCharacter, type CharacterTemplate, type RawModel } from './character-model';

/**
 * Armour models are authored on the character's own skeleton (same pivots): each top-level group
 * belongs to one body bone. This maps an armour group name to the character bone it rides on.
 */
export function armorBoneFor(name: string): string | null {
  const n = name.toLowerCase();
  if (n === 'root') return null;
  const side = n.includes('right') ? 'right' : n.includes('left') ? 'left' : null;
  if (side && /arm|shoulder|sleeve/.test(n)) return `arm_${side}`;
  if (side && /leg|boot|shin|knee/.test(n)) return `leg_${side}`;
  if (/helmet|nvg|visor|brim|chin|shield|neck|rail|mount|cap|hat|goggle/.test(n)) return 'head';
  if (/chest|collar|hem|legging|suspender|vest|belt|torso|back/.test(n)) return 'body';
  return null;
}

const cache = new Map<number, Promise<CharacterTemplate | null>>();

/** Loads (once) the model of an armour piece by wire id; null if it has no model or fails. */
export function loadArmorModel(id: number): Promise<CharacterTemplate | null> {
  let p = cache.get(id);
  if (p) return p;
  const spec = ARMOR_BY_ID.get(id);
  p = spec
    ? fetch(spec.model)
        .then((r) => {
          if (!r.ok) throw new Error(`armour model ${spec.model} unavailable (${r.status})`);
          return r.json() as Promise<RawModel>;
        })
        .then(async (raw) => mirrorCharacter(await buildBBModel(raw)))
        .catch((err: unknown) => {
          console.warn('armour model failed to load', err);
          return null;
        })
    : Promise.resolve(null);
  cache.set(id, p);
  return p;
}

/** Already-loaded template (or undefined while loading). */
export const loadedArmor = new Map<number, CharacterTemplate | null>();
export function requestArmor(id: number, onReady: () => void): CharacterTemplate | null | undefined {
  if (loadedArmor.has(id)) return loadedArmor.get(id);
  void loadArmorModel(id).then((t) => {
    loadedArmor.set(id, t);
    onReady();
  });
  return undefined;
}

/**
 * Splits a cloned armour model into per-bone pieces, positioned relative to each bone's rest
 * position (`restOf(bone)` = that bone's rest position in model space).
 */
export function armorPieces(template: CharacterTemplate, restOf: (bone: string) => Vector3 | undefined): Array<{ bone: string; object: Object3D }> {
  const root = template.root.clone(true);
  root.updateMatrixWorld(true);
  const out: Array<{ bone: string; object: Object3D }> = [];
  const wp = new Vector3();
  const visit = (node: Object3D, fallback: string | null = null) => {
    for (const child of [...node.children]) {
      // A container of left/right pieces (e.g. "leggings" → leg_left / leg_right): split it so
      // each piece follows its own limb instead of the whole group riding stiffly on the body.
      if (child.children.some((c) => /right|left/i.test(c.name))) {
        visit(child, armorBoneFor(child.name) ?? fallback);
        continue;
      }
      let bone = armorBoneFor(child.name);
      // Loose geometry under a container group: ride on the head if it sits that high, else the body.
      if (!bone && (child as { isMesh?: boolean }).isMesh) bone = fallback ?? (child.getWorldPosition(wp).y > 1.25 ? 'head' : 'body');
      const rest = bone ? restOf(bone) : undefined;
      if (bone && rest) {
        child.getWorldPosition(wp);
        child.removeFromParent();
        child.position.copy(wp).sub(rest);
        child.traverse((o) => {
          o.castShadow = true;
          // Never treated as an animated bone of the wearer.
          delete o.userData.restPos;
          delete o.userData.restRot;
        });
        out.push({ bone, object: child });
      } else if (child.children.length) visit(child, fallback);
    }
  };
  visit(root);
  return out;
}

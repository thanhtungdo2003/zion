import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Group, Vector3, type Object3D } from 'three';
import type * as CharacterModelModule from './character-model';

type CharacterModule = typeof CharacterModelModule;

// Serve model files from disk without textures (there is no Image in Node).
vi.mock('@/lib/preload', () => ({ cachedFetch: vi.fn() }));
vi.mock('./character-model', async (orig) => {
  const real = await orig<CharacterModule>();
  return { ...real, fetchWithProgress: async (url: string) => JSON.stringify(withoutTextures(url)) };
});

import { buildBBModel, BB_UNITS_PER_METER } from './character-model';
import { builtinWeaponVisual, previewAttachment } from './weapons';

function withoutTextures(url: string) {
  const model = JSON.parse(readFileSync(`apps/web/public${url.split('?')[0]}`, 'utf8'));
  model.textures = [];
  return model;
}

/** Lowest vertex of `object` along `axis`, in world space. */
function lowest(object: Object3D, axis: Vector3): number {
  let min = Infinity;
  const v = new Vector3();
  object.traverse((o) => {
    const pos = (o as { geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).geometry?.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) min = Math.min(min, v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld).dot(axis));
  });
  return min;
}

describe('optics mount on the rail point', () => {
  for (const [gunId, optic] of [['awm', 'scope_8x'], ['awm', 'scope_10x'], ['aug', 'scope_4x'], ['ak47', 'red_dot'], ['kar98k', 'scope_4x']] as const) {
    it(`${gunId} + ${optic}: the optic's base touches the rail (no gap, no sinking)`, async () => {
      const spec = builtinWeaponVisual(gunId)!;
      const { root } = await buildBBModel(withoutTextures(spec.url));
      const holder = new Group();
      holder.add(root);
      const part = await previewAttachment(spec, root, optic);
      expect(part).not.toBeNull();
      holder.add(part!);
      holder.updateMatrixWorld(true);
      const up = new Vector3(...spec.up).normalize();
      const offset = spec.attachmentOffset?.[optic] ?? [0, 0, 0];
      const rail = new Vector3(...spec.rail!).add(new Vector3(...offset)).multiplyScalar(1 / BB_UNITS_PER_METER);
      // The clamp's jaws hug the rail head: its lowest point is the jaw tips, the rail's height
      // (minus the neck) below the rail top — never lower, never floating above it.
      const unitsPerMetre = (-lowest(root, new Vector3(...spec.barrel).negate()) - lowest(root, new Vector3(...spec.barrel))) * BB_UNITS_PER_METER / spec.length;
      const gap = (lowest(part!, up) - rail.dot(up)) * BB_UNITS_PER_METER / unitsPerMetre;
      expect(gap).toBeLessThanOrEqual(0.0005);
      expect(gap).toBeGreaterThan(-(0.0094 - 0.003) - 0.0015);
    });
  }
});

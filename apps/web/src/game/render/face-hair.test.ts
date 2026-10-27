import { untexturedGlb } from './test-glb';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { type BufferAttribute, Vector3 } from 'three';
import { BEARD_STYLES, DEFAULT_APPEARANCE, parseAppearance } from '@zion/shared';
import { parseHumanAssets } from './human-rig';
import { beardDensity, beardGeometry, type FaceSkin } from './face-hair';

describe('facial hair', () => {
  it('grows each beard where it belongs and never on the lips, eyes or forehead', () => {
    const at = (x: number, y: number, z: number) => new Vector3(x, y, z);
    const lip = at(0, 1.534, .072), upperLip = at(0, 1.546, .072), chin = at(0, 1.5, .065), jawSide = at(.05, 1.52, .02), sideburn = at(.058, 1.585, 0), eye = at(.03, 1.59, .06), cheek = at(.035, 1.575, .05);
    for (const s of BEARD_STYLES) { expect(beardDensity(s, lip)).toBe(0); expect(beardDensity(s, eye)).toBe(0); expect(beardDensity(s, cheek)).toBe(0); }
    expect(beardDensity('mustache', upperLip)).toBeGreaterThan(.5);
    expect(beardDensity('mustache', chin)).toBe(0);
    expect(beardDensity('goatee', chin)).toBeGreaterThan(.5);
    expect(beardDensity('goatee', jawSide)).toBe(0);
    for (const p of [jawSide, sideburn, chin, upperLip]) expect(beardDensity('full', p)).toBeGreaterThan(.5);
  });

  it('builds the shells from the face skin, skinned like it', async () => {
    const a = await parseHumanAssets(untexturedGlb(await readFile(new URL('../../../../../models/characters/zion-survivor.glb', import.meta.url))));
    const g = a.bodies.top;
    const skin: FaceSkin = { position: g.getAttribute('position') as BufferAttribute, normal: g.getAttribute('normal') as BufferAttribute, skinIndex: g.getAttribute('skinIndex') as BufferAttribute, skinWeight: g.getAttribute('skinWeight') as BufferAttribute, index: g.getIndex()! };
    expect(beardGeometry(skin, 'none')).toBeNull();
    const full = beardGeometry(skin, 'full')!, mustache = beardGeometry(skin, 'mustache')!;
    expect(full.getIndex()!.count).toBeGreaterThan(mustache.getIndex()!.count * 3);
    expect(full.getAttribute('skinIndex').count).toBe(full.getAttribute('position').count);
    expect(beardGeometry(skin, 'full')).toBe(full);
  }, 60_000);

  it('keeps looks saved before the new face sliders, eyebrows and beards', () => {
    const old = { ...DEFAULT_APPEARANCE, face: { head: 10, jaw: 0, chin: 0, cheeks: 0, nose: 0, brow: 0, eyes: 0, ears: 0 } } as Record<string, unknown>;
    delete old.brows; delete old.beard;
    const look = parseAppearance(old)!;
    expect(look.face.head).toBe(10);
    expect(look.face.lips).toBe(0);
    expect(look.brows).toBe(1);
    expect(look.beard).toBe('none');
  });
});

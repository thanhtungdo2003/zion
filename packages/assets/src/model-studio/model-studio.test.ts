import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../builtin';
import { glbTriangles, solidMaterial } from '../uploaded-maps';
import { emptyDoc, parseDoc } from './doc';
import { evaluate } from './evaluate';
import { exportModel } from './export';
import { readGltf } from './gltf';
import { generateHouse } from './house';
import { materialFromPreset } from './materials';
import { materialTextures } from './textures';
import { runTool, type CatalogAsset, type ToolState } from './tools';
import { validateDoc } from './validate';
import { studioModelAsset } from './game-asset';

const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b));
const registry = createDefaultRegistry();
const catalog: CatalogAsset[] = registry.all().map((a) => ({ id: a.numericId, key: a.id, name: a.name, category: a.category, model: a.model.kind, tags: a.tags, radius: a.bounds.radius, height: a.bounds.height }));
const assetCtx = { asset: (id: number) => registry.byNumericId(id) };

describe('model studio: house generator', () => {
  for (const [style, floors, years] of [['rural', 1, 0], ['postapoc', 2, 200], ['modern', 2, 30], ['cottage', 1, 80]] as const) {
    it(`builds a valid ${style} house (${floors} floor, ${years} years)`, () => {
      const doc = emptyDoc('Nhà', 'building');
      const r = generateHouse(doc, { seed: 42, style, floors, abandonedYears: years });
      parseDoc(doc);
      expect(r.rooms.length).toBeGreaterThanOrEqual(floors === 2 ? 6 : 5);
      expect(r.doors).toBeGreaterThanOrEqual(r.rooms.length);
      expect(r.windows).toBeGreaterThan(3);
      expect(r.notes.filter((n) => n.includes('không nối được'))).toEqual([]);
      const v = validateDoc(doc, assetCtx);
      expect(v.issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(v.issues.filter((i) => i.code === 'flipped-normals')).toEqual([]);
      expect(v.stats.size![1]).toBeGreaterThan(floors === 2 ? 6 : 3.4);
      expect(v.stats.triangles).toBeLessThan(120_000);
      // Every room has a floor and the house is reachable: entrance door on the front wall.
      const front = doc.nodes.find((n) => n.kind === 'wall' && n.name === 'Tường trước');
      expect(front && front.kind === 'wall' && front.openings.some((o) => o.kind === 'door')).toBe(true);
      if (floors === 2) {
        const stairs = doc.nodes.find((n) => n.kind === 'stairs')!;
        expect(stairs.kind === 'stairs' && stairs.rise / stairs.steps).toBeLessThan(.2);
        expect(doc.nodes.some((n) => n.kind === 'slab' && n.holes.length > 0)).toBe(true);
      }
    });
  }

  it('is deterministic for its seed', () => {
    const a = emptyDoc(), b = emptyDoc();
    generateHouse(a, { seed: 7, floors: 2 });
    generateHouse(b, { seed: 7, floors: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('model studio: textures and export', () => {
  it('generates every PBR map within physical ranges', () => {
    const rock = materialTextures(materialFromPreset('r', 'rock_granite', { moss: .5 }), 64);
    const steel = materialTextures(materialFromPreset('s', 'metal_steel'), 64);
    const mean = (t: Uint8Array, c: number) => { let s = 0; for (let i = c; i < t.length; i += 4) s += t[i]!; return s / (t.length / 4) / 255; };
    expect(mean(rock.orm, 1)).toBeGreaterThan(.7);
    expect(mean(rock.orm, 2)).toBeLessThan(.02);
    expect(mean(steel.orm, 2)).toBeGreaterThan(.9);
    // Normal maps point out of the surface.
    expect(mean(rock.normal, 2)).toBeGreaterThan(.7);
    expect(materialTextures(materialFromPreset('r', 'rock_granite', { moss: .5 }), 64)).toBe(rock);
  });

  it('exports an editable GLB that reads back with hierarchy, materials, textures and the project', () => {
    const doc = emptyDoc('Nhà', 'building');
    generateHouse(doc, { seed: 3, floors: 1, garden: false });
    const out = exportModel(doc, { mode: 'editable', deflate, textureSize: 64 });
    const back = readGltf(out.glb);
    expect(back.nodes.length).toBe(doc.nodes.length);
    expect(back.materials.length).toBe(doc.materials.length * 2);
    expect(back.materials.every((m) => m.baseColorTexture && m.normalTexture && m.metallicRoughnessTexture && m.occlusionTexture)).toBe(true);
    expect(back.images.every((i) => i.bytes[1] === 0x50)).toBe(true);
    expect(parseDoc(back.extras!.zionModelDoc)).toEqual(JSON.parse(JSON.stringify(doc)));
    const names = new Set(back.nodes.map((n) => n.name));
    expect(names.has('Tường trước') && names.has('Mái nhà')).toBe(true);
  });

  it('exports a game GLB: one primitive per material, the walls collide, glass does not', () => {
    const doc = emptyDoc('Nhà', 'building');
    generateHouse(doc, { seed: 5, floors: 2 });
    const out = exportModel(doc, { mode: 'game', deflate, textureSize: 64 });
    const back = readGltf(out.glb);
    expect(back.meshes).toHaveLength(1);
    expect(back.meshes[0]!.primitives.length).toBeLessThanOrEqual(doc.materials.length * 2);
    // Garden trees and dining chairs stay game models (instanced), not copies.
    expect(out.refs.length).toBeGreaterThan(0);
    const solid = glbTriangles(out.glb, true), all = glbTriangles(out.glb, false);
    expect(solid.length).toBeGreaterThan(1000);
    expect(solid.length).toBeLessThan(all.length);
    const glass = back.materials.findIndex((m) => m.name.startsWith('Kính'));
    expect(solidMaterial(back.materials[glass] as never)).toBe(false);
    const ev = evaluate(doc);
    const def = studioModelAsset({ asset: 3001, name: 'Nhà', kind: 'building', min: [-10, 0, -10], max: [10, 8, 10], refs: out.refs });
    expect(() => createDefaultRegistry().registerUploaded(def)).not.toThrow();
    expect(ev.draws.length).toBeGreaterThan(50);
  });
});

describe('model studio: tools', () => {
  const state = (): ToolState => ({ doc: emptyDoc('Thử', 'prop'), host: { assets: catalog }, changed: false });

  it('creates a rock with a PBR material, validates and fixes it', async () => {
    const s = state();
    const made = await runTool('create_geometry', { type: 'rock_formation', params: { size: 3, count: 4, seed: 9 } }, s);
    expect(made.ok).toBe(true);
    const mat = await runTool('create_or_edit_material', { id: 'rock_granite', texture: { moss: .4, cracks: .3 } }, s);
    expect(mat.ok).toBe(true);
    const v = await runTool('validate_asset', {}, s);
    expect(v.ok && (v.result as { ok: boolean }).ok).toBe(true);
    // Lift it off the ground: validation flags it, auto_fix puts it back.
    await runTool('edit_transform', { node: s.doc.nodes[0]!.id, position: [0, 2, 0] }, s);
    const fixed = await runTool('auto_fix', {}, s);
    expect(fixed.ok && (fixed.result as { fixed: string[] }).fixed.some((f) => f.includes('mặt đất'))).toBe(true);
  });

  it('assembles game models and rejects unknown ones and bad arguments', async () => {
    const s = state();
    const ok = await runTool('assemble_model', { group: 'Bàn ăn', parts: [{ asset: 2850, position: [0, 0, 0] }, { asset: 2856, position: [0, 0, .8], rotation: [0, 180, 0] }] }, s);
    expect(ok.ok).toBe(true);
    expect(s.doc.nodes.filter((n) => n.kind === 'asset')).toHaveLength(2);
    expect((await runTool('assemble_model', { parts: [{ asset: 1, position: [0, 0, 0] }, { asset: 64000, position: [0, 0, 0] }] }, s)).ok).toBe(false);
    expect((await runTool('edit_transform', { node: 'nope' }, s)).ok).toBe(false);
    expect((await runTool('create_geometry', { type: 'castle' }, s)).ok).toBe(false);
    const found = await runTool('search_assets', { query: 'chair' }, s);
    expect(found.ok && (found.result as { assets: Array<{ id: number }> }).assets.some((a) => a.id === 2856)).toBe(true);
  });

  it('builds a house through the tool and reports its rooms', async () => {
    const s = state();
    const r = await runTool('create_geometry', { type: 'house', params: { style: 'postapoc', floors: 2, rooms: ['living', 'kitchen', 'dining', 'bedroom', 'bedroom', 'bathroom'], abandonedYears: 200, seed: 11 } }, s);
    expect(r.ok).toBe(true);
    expect(s.doc.kind).toBe('building');
    expect((r as { result: { rooms: string[] } }).result.rooms.length).toBeGreaterThanOrEqual(6);
  });
});

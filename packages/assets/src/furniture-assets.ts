import type { AssetDefinitionInput } from './schema';

/**
 * Indoor furniture (tables and chairs from the "dining room furniture" pack, split per piece and
 * converted to metres in Blender: models/furniture/*.glb, origin at the floor under the centre).
 * Solid to walk and shoot against: a table by its top and legs' box, a chair by its seat and back.
 * Tables run along x; a chair faces +z (its back towards −z).
 */
export const FURNITURE_ASSET = {
  tableLong: 2850, tableDark: 2851, tableWood: 2852, tableRed: 2853, tableRound: 2854, chairMetal: 2855, chairWood: 2856,
} as const;

/** [key, file, width (x), depth (z), height, chair] in metres. */
const PIECES = [
  ['tableLong', 'table-long', 2.95, 1, .72, false],
  ['tableDark', 'table-dark', 1.9, .9, .75, false],
  ['tableWood', 'table-wood', 2.03, .91, .74, false],
  ['tableRed', 'table-red', 1.42, .71, .74, false],
  ['tableRound', 'table-round', .9, .9, .73, false],
  ['chairMetal', 'chair-metal', .51, .66, 1.1, true],
  ['chairWood', 'chair-wood', .46, .64, 1.04, true],
] as const;

export const FURNITURE_ASSETS: readonly AssetDefinitionInput[] = PIECES.map(([key, file, w, d, h, chair]): AssetDefinitionInput => ({
  id: `furniture.${file.replace('-', '_')}`, numericId: FURNITURE_ASSET[key], name: file.replace('-', ' '), category: 'decor',
  model: { kind: 'glb', path: `furniture/${file}.glb` },
  // A table: its top slab (crouch under is not modelled); a chair: seat block plus its back.
  colliders: chair
    ? [{ type: 'box', center: [0, .25, 0], halfExtents: [w / 2, .25, d / 2] }, { type: 'box', center: [0, h * .7, -(d / 2 - .1)], halfExtents: [w / 2, h * .3, .05] }]
    : [{ type: 'box', center: [0, h / 2, 0], halfExtents: [w / 2, h / 2, d / 2] }],
  bounds: { radius: Math.hypot(w, d) / 2, height: h }, render: { maxDistance: 90 }, tags: ['furniture', 'indoor'],
}));

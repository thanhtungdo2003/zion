import type { ModelMaterial, TexturePattern } from './doc';
import { seedOf } from './noise';

/**
 * Real-world material knowledge for PBR: base colour (albedo, sRGB), roughness and metalness in
 * the ranges physically based renderers expect, the surface pattern that carries the normal,
 * roughness and occlusion detail, and how big one tile of it is. Values follow the usual
 * measured-albedo charts (dielectrics 0.04 F0, metals by their reflectance colour; charcoal ≈ 4%,
 * fresh snow ≈ 85%, concrete 20–40%, ...). The agent and the editor start a material from one of
 * these and adjust it for style and wear instead of guessing numbers.
 */
export interface MaterialPreset {
  id: string;
  name: string;
  /** Words (English and Vietnamese) that call for it. */
  keywords: string[];
  color: string;
  accent?: string;
  roughness: number;
  metalness: number;
  normalStrength: number;
  aoStrength: number;
  opacity?: number;
  pattern: TexturePattern;
  /** Metres per texture tile. */
  scale: number;
  variation: number;
  /** Ranges a sensible variant stays within. */
  range: { roughness: [number, number]; metalness: [number, number] };
  note: string;
}

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  { id: 'rock_granite', name: 'Đá granite', keywords: ['rock', 'stone', 'boulder', 'granite', 'cliff', 'đá', 'tảng đá', 'núi đá'], color: '#7a756f', accent: '#5e5a56', roughness: .86, metalness: 0, normalStrength: 1.6, aoStrength: 1, pattern: 'rock', scale: 2.5, variation: .5, range: { roughness: [.7, .95], metalness: [0, 0] }, note: 'Natural rock: rough, non-metal, layered and uneven; albedo 25–40%.' },
  { id: 'rock_sandstone', name: 'Đá sa thạch', keywords: ['sandstone', 'sa thạch', 'đá vàng'], color: '#b39370', accent: '#8a6c4d', roughness: .9, metalness: 0, normalStrength: 1.3, aoStrength: .9, pattern: 'rock', scale: 3, variation: .45, range: { roughness: [.8, .97], metalness: [0, 0] }, note: 'Sedimentary rock: strong horizontal strata, very rough.' },
  { id: 'stone_wall', name: 'Tường đá hộc', keywords: ['stone wall', 'cobble', 'fieldstone', 'tường đá', 'đá hộc'], color: '#7d776f', accent: '#4f4a44', roughness: .88, metalness: 0, normalStrength: 1.5, aoStrength: 1, pattern: 'stone', scale: 1.6, variation: .5, range: { roughness: [.75, .95], metalness: [0, 0] }, note: 'Masonry of rounded stones in mortar: deep joints (AO), rough faces.' },
  { id: 'brick_red', name: 'Gạch đỏ', keywords: ['brick', 'gạch', 'gạch đỏ'], color: '#8e4a36', accent: '#b9ae9f', roughness: .82, metalness: 0, normalStrength: 1.2, aoStrength: .9, pattern: 'brick', scale: 1.2, variation: .45, range: { roughness: [.7, .92], metalness: [0, 0] }, note: 'Fired clay brick, 215×65 mm with 10 mm mortar joints; matte.' },
  { id: 'plaster_white', name: 'Vữa trát trắng', keywords: ['plaster', 'stucco', 'vữa', 'tường trát', 'sơn tường', 'interior wall'], color: '#d8d2c4', roughness: .78, metalness: 0, normalStrength: .5, aoStrength: .6, pattern: 'plaster', scale: 2.5, variation: .3, range: { roughness: [.6, .9], metalness: [0, 0] }, note: 'Painted lime/cement render: smooth but matte, fine trowel marks.' },
  { id: 'plaster_ochre', name: 'Vữa vàng đất', keywords: ['ochre', 'yellow wall', 'tường vàng'], color: '#c9a66b', roughness: .8, metalness: 0, normalStrength: .55, aoStrength: .6, pattern: 'plaster', scale: 2.5, variation: .35, range: { roughness: [.65, .9], metalness: [0, 0] }, note: 'Lime wash in earth pigment, common on old houses.' },
  { id: 'concrete', name: 'Bê tông', keywords: ['concrete', 'cement', 'bê tông', 'xi măng'], color: '#8f8c86', roughness: .9, metalness: 0, normalStrength: .8, aoStrength: .7, pattern: 'concrete', scale: 2, variation: .4, range: { roughness: [.75, .97], metalness: [0, 0] }, note: 'Cast concrete: rough, pores, shuttering marks, stains; albedo 25–35%.' },
  { id: 'wood_oak', name: 'Gỗ sồi', keywords: ['wood', 'timber', 'oak', 'gỗ', 'gỗ sồi', 'furniture'], color: '#7a5634', accent: '#4e3420', roughness: .62, metalness: 0, normalStrength: .7, aoStrength: .6, pattern: 'wood', scale: 1, variation: .45, range: { roughness: [.45, .8], metalness: [0, 0] }, note: 'Sealed hardwood: visible grain, medium roughness (oiled .5, raw .75).' },
  { id: 'wood_planks', name: 'Ván gỗ', keywords: ['planks', 'floorboards', 'boards', 'deck', 'ván', 'sàn gỗ'], color: '#86633f', accent: '#4a321e', roughness: .7, metalness: 0, normalStrength: 1, aoStrength: .8, pattern: 'planks', scale: 2, variation: .5, range: { roughness: [.55, .9], metalness: [0, 0] }, note: 'Boards 12–18 cm wide with gaps; each board a slightly different tone.' },
  { id: 'wood_weathered', name: 'Gỗ mục phong hoá', keywords: ['weathered wood', 'old wood', 'rotten', 'gỗ mục', 'gỗ cũ', 'barn'], color: '#7c766c', accent: '#4b463f', roughness: .9, metalness: 0, normalStrength: 1.2, aoStrength: .9, pattern: 'planks', scale: 2, variation: .6, range: { roughness: [.8, .97], metalness: [0, 0] }, note: 'Sun-greyed timber: lignin washed out, raised grain, very rough.' },
  { id: 'metal_steel', name: 'Thép', keywords: ['steel', 'metal', 'iron', 'thép', 'kim loại', 'sắt'], color: '#8c8f93', roughness: .38, metalness: 1, normalStrength: .4, aoStrength: .5, pattern: 'metal', scale: 1, variation: .25, range: { roughness: [.2, .6], metalness: [.9, 1] }, note: 'Bare steel: fully metallic, reflectance ≈ 56% grey; brushed .3–.45.' },
  { id: 'metal_rust', name: 'Sắt gỉ', keywords: ['rust', 'rusty', 'corroded', 'gỉ', 'sét', 'han gỉ'], color: '#6b4630', accent: '#8a8f93', roughness: .82, metalness: .35, normalStrength: 1, aoStrength: .8, pattern: 'rust', scale: 1.2, variation: .6, range: { roughness: [.65, .95], metalness: [.1, .6] }, note: 'Rust is an oxide (non-metal, rough); bare metal shows through where it flaked.' },
  { id: 'metal_corrugated', name: 'Tôn sóng', keywords: ['corrugated', 'tin roof', 'sheet metal', 'tôn', 'mái tôn'], color: '#7d8287', accent: '#6b4630', roughness: .5, metalness: .8, normalStrength: 1.4, aoStrength: .6, pattern: 'corrugated', scale: 1.5, variation: .4, range: { roughness: [.35, .8], metalness: [.5, 1] }, note: 'Galvanised steel sheet, 76 mm waves; zinc dulls to rough grey with age.' },
  { id: 'roof_tiles', name: 'Ngói đất nung', keywords: ['roof tiles', 'terracotta', 'ngói', 'mái ngói'], color: '#9a4f35', accent: '#5e2f20', roughness: .78, metalness: 0, normalStrength: 1.4, aoStrength: 1, pattern: 'roof_tiles', scale: 1.5, variation: .45, range: { roughness: [.65, .9], metalness: [0, 0] }, note: 'Fired clay tiles in overlapping courses; joints read as dark AO lines.' },
  { id: 'roof_shingles', name: 'Ngói bitum', keywords: ['shingles', 'asphalt roof', 'ngói bitum'], color: '#4a4744', accent: '#2c2a28', roughness: .9, metalness: 0, normalStrength: 1.1, aoStrength: .9, pattern: 'shingles', scale: 1.5, variation: .35, range: { roughness: [.8, .97], metalness: [0, 0] }, note: 'Asphalt shingles with mineral granules: very rough, dark.' },
  { id: 'fabric', name: 'Vải', keywords: ['fabric', 'cloth', 'sofa', 'textile', 'vải', 'nệm', 'đệm'], color: '#5b6470', roughness: .95, metalness: 0, normalStrength: .5, aoStrength: .5, pattern: 'fabric', scale: .3, variation: .2, range: { roughness: [.85, 1], metalness: [0, 0] }, note: 'Woven textile: diffuse, almost no specular, fine weave normal.' },
  { id: 'ceramic_tiles', name: 'Gạch men', keywords: ['tiles', 'ceramic', 'kitchen floor', 'bathroom', 'gạch men', 'gạch lát'], color: '#c8c3b8', accent: '#8d877b', roughness: .3, metalness: 0, normalStrength: .6, aoStrength: .6, pattern: 'tiles', scale: .9, variation: .2, range: { roughness: [.15, .5], metalness: [0, 0] }, note: 'Glazed ceramic: smooth glossy faces, rough grout lines.' },
  { id: 'glass', name: 'Kính', keywords: ['glass', 'window', 'pane', 'kính', 'cửa kính'], color: '#a8c4cc', roughness: .05, metalness: 0, normalStrength: .1, aoStrength: 0, opacity: .3, pattern: 'glass', scale: 1, variation: .05, range: { roughness: [0, .2], metalness: [0, 0] }, note: 'Float glass: smooth, transparent (alpha blend here; no refraction in the game renderer).' },
  { id: 'glass_dirty', name: 'Kính bẩn', keywords: ['dirty glass', 'frosted', 'kính bẩn', 'kính mờ'], color: '#9aa69c', roughness: .35, metalness: 0, normalStrength: .2, aoStrength: 0, opacity: .55, pattern: 'glass', scale: 1, variation: .3, range: { roughness: [.2, .6], metalness: [0, 0] }, note: 'Grimy glass: dust raises roughness and lowers transparency.' },
  { id: 'ground_dirt', name: 'Đất', keywords: ['dirt', 'soil', 'mud', 'đất', 'bùn'], color: '#6b5640', roughness: .95, metalness: 0, normalStrength: 1, aoStrength: .8, pattern: 'ground', scale: 3, variation: .5, range: { roughness: [.8, 1], metalness: [0, 0] }, note: 'Bare soil: very rough, dark when damp.' },
  { id: 'grass', name: 'Cỏ', keywords: ['grass', 'lawn', 'yard', 'garden', 'cỏ', 'sân cỏ', 'vườn'], color: '#5d7a3a', accent: '#7d8c4a', roughness: .92, metalness: 0, normalStrength: .9, aoStrength: .7, pattern: 'grass', scale: 3, variation: .5, range: { roughness: [.8, 1], metalness: [0, 0] }, note: 'Lawn seen from above: blade clumps, dry patches.' },
  { id: 'gravel', name: 'Sỏi', keywords: ['gravel', 'path', 'pebbles', 'sỏi', 'lối đi', 'đường sỏi'], color: '#8a8378', accent: '#5f5952', roughness: .93, metalness: 0, normalStrength: 1.4, aoStrength: 1, pattern: 'gravel', scale: 1.5, variation: .5, range: { roughness: [.8, 1], metalness: [0, 0] }, note: 'Loose stones 1–3 cm: strong small-scale AO and normal.' },
  { id: 'bark', name: 'Vỏ cây', keywords: ['bark', 'trunk', 'vỏ cây', 'thân cây'], color: '#4f3d2c', accent: '#2d2219', roughness: .93, metalness: 0, normalStrength: 1.6, aoStrength: 1, pattern: 'bark', scale: 1.2, variation: .4, range: { roughness: [.85, 1], metalness: [0, 0] }, note: 'Furrowed bark: vertical ridges, very rough.' },
  { id: 'leaves', name: 'Tán lá', keywords: ['leaves', 'foliage', 'canopy', 'hedge', 'lá', 'tán cây', 'bụi cây'], color: '#3f5f2a', accent: '#6c7f35', roughness: .8, metalness: 0, normalStrength: .8, aoStrength: .8, pattern: 'leaves', scale: 1, variation: .5, range: { roughness: [.6, .9], metalness: [0, 0] }, note: 'Leaf clusters: medium-rough waxy leaves, deep self-shadowing.' },
  { id: 'paint_metal', name: 'Kim loại sơn', keywords: ['painted metal', 'appliance', 'fridge', 'tủ lạnh', 'sơn'], color: '#d0d0cc', roughness: .4, metalness: 0, normalStrength: .2, aoStrength: .4, pattern: 'plain', scale: 1, variation: .15, range: { roughness: [.25, .6], metalness: [0, .1] }, note: 'Paint is a dielectric coat: metalness 0 even on a steel body.' },
  { id: 'rubber', name: 'Cao su / nhựa đen', keywords: ['rubber', 'plastic', 'tyre', 'cao su', 'nhựa'], color: '#2a2a2a', roughness: .85, metalness: 0, normalStrength: .3, aoStrength: .5, pattern: 'noise', scale: .5, variation: .15, range: { roughness: [.6, .95], metalness: [0, 0] }, note: 'Carbon-black rubber: albedo ≈ 4%, rough.' },
];

export function materialPreset(id: string): MaterialPreset | undefined { return MATERIAL_PRESETS.find((p) => p.id === id); }

/** The preset whose keywords best match a description (English or Vietnamese). */
export function matchPreset(text: string): MaterialPreset {
  const t = text.toLowerCase();
  let best = MATERIAL_PRESETS[0]!, score = 0;
  for (const p of MATERIAL_PRESETS) {
    let s = p.id === t ? 100 : 0;
    for (const k of p.keywords) if (t.includes(k)) s = Math.max(s, k.length);
    if (s > score) { score = s; best = p; }
  }
  return best;
}

/** A material from a preset, with overrides (weathering, tint) kept inside the preset's range. */
export function materialFromPreset(id: string, presetId: string, overrides: Partial<Pick<ModelMaterial, 'name' | 'color' | 'roughness' | 'metalness' | 'opacity'>> & { wear?: number; dirt?: number; moss?: number; cracks?: number; scale?: number; seed?: number } = {}): ModelMaterial {
  const p = materialPreset(presetId) ?? matchPreset(presetId);
  const clamp = (v: number, [a, b]: [number, number]) => Math.max(a, Math.min(b, v));
  const wear = overrides.wear ?? 0, moss = overrides.moss ?? 0, dirt = overrides.dirt ?? 0;
  // Weathering roughens a surface (dust, oxide, lichen) — within what the material can be.
  const roughness = clamp((overrides.roughness ?? p.roughness) + wear * .1 + moss * .06 + dirt * .05, [p.range.roughness[0], Math.min(1, p.range.roughness[1] + .05)]);
  return {
    id, name: overrides.name ?? p.name, preset: p.id,
    color: overrides.color ?? p.color,
    roughness, metalness: clamp(overrides.metalness ?? p.metalness, p.range.metalness),
    normalStrength: p.normalStrength, aoStrength: p.aoStrength, opacity: overrides.opacity ?? p.opacity ?? 1,
    ...(p.opacity !== undefined && p.opacity < 1 ? { doubleSided: true } : {}),
    texture: {
      pattern: p.pattern, scale: overrides.scale ?? p.scale, seed: overrides.seed ?? seedOf(`${id}:${p.id}`),
      wear, dirt, moss, cracks: overrides.cracks ?? 0, variation: p.variation, ...(p.accent ? { accent: p.accent } : {}),
    },
  };
}

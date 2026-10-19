import type { AssetDefinitionInput } from './schema';

/**
 * Road furniture: traffic signs (pixel-art plates on 2.6 m poles, facing −Z) and the imported
 * barrier / cone / traffic-light pack (prepared assets 2680–2693).
 */
export const SIGN_KINDS = ['stop', 'giveway', 'speed50', 'speed80', 'curveleft', 'curveright', 'crossing', 'zombies', 'danger', 'oneway'] as const;
export type SignKind = (typeof SIGN_KINDS)[number];
export const SIGN_ASSET = Object.fromEntries(SIGN_KINDS.map((k, i) => [k, 2720 + i])) as Record<SignKind, number>;
export const ROAD_ASSET = {
  barrier3Sign: 2680, barrier3: 2681, barrier6: 2682, barrier2: 2683, barrier8: 2684, postGrey: 2685, post: 2686,
  cone: 2687, conePole: 2688, barrierLeft: 2689, barrierRight: 2690, lightShort: 2691, lightLong: 2692, pedestrianLight: 2693,
} as const;

export const ROAD_ASSETS: readonly AssetDefinitionInput[] = SIGN_KINDS.map((kind): AssetDefinitionInput => ({
  id: `road.sign_${kind}`, numericId: SIGN_ASSET[kind], name: `Road sign (${kind})`, category: 'decor',
  model: { kind: 'bbmodel', path: `dists/signs/sign-${kind}.bbmodel`, unitsPerMeter: 16 },
  colliders: [{ type: 'box', center: [0, 1.3, 0], halfExtents: [.05, 1.3, .05] }],
  bounds: { radius: .4, height: 2.9 }, render: { maxDistance: 260 }, tags: ['road-furniture', 'sign'],
}));

/** Civic grounds: a football pitch with its lines, concrete grandstand tiers. */
export const CIVIC_ASSET = { pitch: 2735, pitchLine: 2736, standTier: 2737 } as const;
export const CIVIC_ASSETS: readonly AssetDefinitionInput[] = ([
  ['civic.pitch', CIVIC_ASSET.pitch, 'Football pitch', 100, .08, 64, '#3d7d34', true],
  ['civic.pitch_line', CIVIC_ASSET.pitchLine, 'Pitch line', 1, .02, .14, '#eeeeea', false],
  ['civic.stand_tier', CIVIC_ASSET.standTier, 'Grandstand tier', 20, .4, 1.4, '#a8a39a', true],
] as const).map(([id, numericId, name, w, h, d, color, solid]): AssetDefinitionInput => ({
  id, numericId, name, category: 'structure',
  model: { kind: 'procedural', generator: 'bridge_block', params: { width: w, height: h, depth: d, color } },
  colliders: solid ? [{ type: 'box', center: [0, h / 2, 0], halfExtents: [w / 2, h / 2, d / 2] }] : [],
  ...(solid ? {} : { collisionLayer: 'none' as const }),
  bounds: { radius: Math.hypot(w, d) / 2, height: h }, render: { maxDistance: 900 }, tags: ['civic'],
}));

/**
 * The light source: an invisible model for the Studios. Wherever it stands the world glows; its
 * scale is the brightness (1 = a street lamp, up to 10). Only the editors draw its marker.
 */
export const LIGHT_SOURCE_ASSET = 2740;
export const LIGHT_ASSETS: readonly AssetDefinitionInput[] = [{
  id: 'light.source', numericId: LIGHT_SOURCE_ASSET, name: 'Nguồn sáng (vô hình)', category: 'decor',
  model: { kind: 'procedural', generator: 'light_source', params: {} },
  colliders: [], collisionLayer: 'none', bounds: { radius: .3, height: .75 }, render: { maxDistance: 120 }, tags: ['light-source'],
}];

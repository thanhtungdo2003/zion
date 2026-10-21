import type { AssetDefinitionInput } from './schema';

/**
 * Blocky rocks: stacks of angular, slightly tilted blocks (stylised, not round boulders), one
 * family per climate / biome and three sizes each. Built by the `blocky_rock` generator.
 */
export const ROCK_STYLES = ['granite', 'sandstone', 'basalt', 'snow', 'mossy', 'limestone'] as const;
export type RockStyle = typeof ROCK_STYLES[number];
const SIZES = [['small', .7], ['medium', 1.8], ['large', 4.2]] as const;

/** Numeric ids 2760–2777: style × size. */
export const BLOCKY_ROCK = Object.fromEntries(ROCK_STYLES.map((style, i) => [style, SIZES.map((_, k) => 2760 + i * 3 + k)])) as Record<RockStyle, [number, number, number]>;

export const ROCK_ASSETS: readonly AssetDefinitionInput[] = ROCK_STYLES.flatMap((style, i) => SIZES.map(([size, s], k): AssetDefinitionInput => ({
  id: `rock.blocky_${style}_${size}`,
  numericId: 2760 + i * 3 + k,
  name: `Blocky ${style} rock (${size})`,
  category: 'rock',
  model: { kind: 'procedural', generator: 'blocky_rock', params: { size: s, style, seed: 17 + i * 7 + k } },
  colliders: [{ type: 'box', center: [0, s * .4, 0], halfExtents: [s * .55, s * .4, s * .5] }],
  bounds: { radius: s * .8, height: s * .95 },
  render: { maxDistance: 120 + s * 90 },
  tags: ['natural', 'rock', 'blocky', `rock-${style}`],
})));

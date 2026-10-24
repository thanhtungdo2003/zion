import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, appearanceHeight, parseAppearance, randomAppearance, sameAppearance } from './appearance';

describe('character appearance', () => {
  it('accepts the default and every random look, and refuses anything else', () => {
    expect(parseAppearance(DEFAULT_APPEARANCE)).toEqual(DEFAULT_APPEARANCE);
    for (let seed = 0; seed < 200; seed++) expect(parseAppearance(randomAppearance(seed))).not.toBeNull();
    expect(parseAppearance(null)).toBeNull();
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, skin: 99 })).toBeNull();
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, face: { ...DEFAULT_APPEARANCE.face, nose: 101 } })).toBeNull();
  });

  it('is deterministic per seed and keeps heights within ±7%', () => {
    expect(sameAppearance(randomAppearance(42), randomAppearance(42))).toBe(true);
    expect(sameAppearance(randomAppearance(42), randomAppearance(43))).toBe(false);
    expect(appearanceHeight({ ...DEFAULT_APPEARANCE, height: -100 })).toBeCloseTo(.93);
    expect(appearanceHeight({ ...DEFAULT_APPEARANCE, height: 100 })).toBeCloseTo(1.07);
  });
});

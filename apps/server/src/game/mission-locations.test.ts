import { describe, expect, it } from 'vitest';
import { chooseMissionStructure } from './mission-locations';

describe('random expedition locations', () => {
  const inside = { kind: 'factory', x: 0, z: 0, radius: 10 };
  const close = { ...inside, x: 500 };
  const far = { ...inside, x: 2000 };
  const wrongKind = { ...far, kind: 'town' };
  it('can select the distant building instead of always selecting the nearest', () => {
    const buildings = [inside, close, wrongKind, far];
    expect(chooseMissionStructure(buildings, 'factory', { x: 0, z: 0 }, () => 0)).toBe(close);
    expect(chooseMissionStructure(buildings, 'factory', { x: 0, z: 0 }, () => 0.99)).toBe(far);
  });
  it('has no fallback to the camp or a different building kind', () => {
    expect(chooseMissionStructure([inside, wrongKind], 'factory', { x: 0, z: 0 })).toBeUndefined();
  });
});

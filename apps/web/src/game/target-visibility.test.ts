import { describe, expect, it } from 'vitest';
import { TargetVisibility } from './target-visibility';

describe('TOP target detection memory', () => {
  it('never discovers an unseen target and expires exactly three seconds after last sight', () => {
    const memory = new TargetVisibility();
    expect(memory.visible(1, false, 0)).toBe(false);
    expect(memory.visible(1, true, 100)).toBe(true);
    expect(memory.visible(1, false, 3099)).toBe(true);
    expect(memory.visible(1, false, 3100)).toBe(false);
    expect(memory.visible(2, false, 3100)).toBe(false);
  });
  it('refreshes only real sightings and clears detections when changing camera modes', () => {
    const memory = new TargetVisibility();
    memory.visible(1, true, 0);
    memory.visible(1, true, 2000);
    expect(memory.visible(1, false, 4999)).toBe(true);
    expect(memory.visible(1, false, 5000)).toBe(false);
    expect(memory.visible(1, true, 6000)).toBe(true);
    memory.clear();
    expect(memory.visible(1, false, 6001)).toBe(false);
  });
});

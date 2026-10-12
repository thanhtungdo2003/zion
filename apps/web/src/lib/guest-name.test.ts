import { describe, expect, it } from 'vitest';
import { randomGuestName } from './guest-name';

describe('guest name suggestions', () => {
  it('generates editable Vietnamese names accepted by the guest API', () => {
    const names = Array.from({ length: 100 }, randomGuestName);
    for (const name of names) {
      expect(name).toMatch(/^[\p{L}\p{N}_ -]{3,20}$/u);
      expect(name.normalize('NFC')).toBe(name);
    }
    expect(new Set(names).size).toBeGreaterThan(90);
  });
});

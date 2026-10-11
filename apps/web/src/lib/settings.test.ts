import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from './settings';

afterEach(() => vi.unstubAllGlobals());
function storage(saved: object) {
  const map = new Map([['zion.settings.v1', JSON.stringify(saved)]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => map.get(key), setItem: (key: string, value: string) => map.set(key, value) });
  return map;
}
describe('camera settings', () => {
  it.each([true, false])('migrates saved first-person preference %s', firstPerson => {
    storage({ firstPerson });
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().cameraMode).toBe(firstPerson ? 'first-person' : 'top-down');
  });
  it('saves and restores third person ahead of the legacy setting', () => {
    const saved = storage({ firstPerson: true, cameraMode: 'third-person' });
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().cameraMode).toBe('third-person');
    settings.set({ cameraMode: 'top-down' });
    expect(JSON.parse(saved.get('zion.settings.v1')!).cameraMode).toBe('top-down');
    settings.set({ cameraMode: 'third-person' });
    const restored = new SettingsStore(); restored.hydrate();
    expect(restored.get().cameraMode).toBe('third-person');
  });
});

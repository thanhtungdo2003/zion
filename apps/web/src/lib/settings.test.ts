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

describe('dodge key settings', () => {
  it('saves a custom prone key and restores it with the dodge key', () => {
    storage({ rollKey: 'KeyV' });
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().proneKey).toBe('KeyC');
    settings.set({ proneKey: 'KeyG' });
    const restored = new SettingsStore(); restored.hydrate();
    expect(restored.get().proneKey).toBe('KeyG');
    expect(restored.get().rollKey).toBe('KeyV');
    restored.set({ rollKey: 'KeyG' });
    expect(restored.get().rollKey).toBe('KeyV');
    restored.set({ proneKey: 'KeyV' });
    expect(restored.get().proneKey).toBe('KeyG');
  });
  it.each(['KeyW', 'KeyM', 'KeyP', 'invalid', 'KeyV'])('repairs an invalid or conflicting saved prone key %s', proneKey => {
    storage({ proneKey, rollKey: 'KeyV' });
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().proneKey).toBe('KeyC');
    expect(settings.get().rollKey).toBe('KeyV');
  });
  it('persists a custom dodge key across sessions', () => {
    storage({});
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().rollKey).toBe('KeyQ');
    settings.set({ rollKey: 'KeyV' });
    const restored = new SettingsStore(); restored.hydrate();
    expect(restored.get().rollKey).toBe('KeyV');
  });
  it.each(['KeyC', 'KeyW', 'KeyP', 'Escape', 'invalid'])('falls back to Q for a conflicting or invalid saved key %s', rollKey => {
    storage({ rollKey });
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().rollKey).toBe('KeyQ');
  });
});

describe('Vietnamese interface', () => {
  it.each([{}, { lang: 'en' }, { lang: 'vi' }])('uses Vietnamese for new and returning players: %j', saved => {
    storage({ ...saved, volume: .5, cameraMode: 'third-person' });
    const settings = new SettingsStore();
    expect(settings.get().lang).toBe('vi');
    settings.hydrate();
    expect(settings.get()).toMatchObject({ lang: 'vi', volume: .5, cameraMode: 'third-person' });
  });
});

describe('automatic touch controls', () => {
  function device(coarse: boolean) {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: coarse }) });
  }

  it.each([true, false])('detects the primary pointer, coarse=%s', coarse => {
    device(coarse);
    storage({});
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().touchControls).toBe(coarse);
  });

  it('enables controls on phones with the previously saved default', () => {
    device(true);
    storage({ touchControls: false, volume: .5 });
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().touchControls).toBe(true);
    expect(settings.get().volume).toBe(.5);
  });

  it('remembers an explicit choice to turn off touch controls', () => {
    device(true);
    storage({});
    const settings = new SettingsStore(); settings.hydrate();
    settings.set({ touchControls: false });
    const restored = new SettingsStore(); restored.hydrate();
    expect(restored.get().touchControls).toBe(false);
  });

  it('keeps automatic detection after saving unrelated settings', () => {
    device(true);
    storage({});
    const settings = new SettingsStore(); settings.hydrate();
    settings.set({ volume: .4 });
    device(false);
    const restored = new SettingsStore(); restored.hydrate();
    expect(restored.get().touchControls).toBe(false);
  });

  it('detects touch even when storage is unavailable', () => {
    device(true);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable'); } });
    const settings = new SettingsStore(); settings.hydrate();
    expect(settings.get().touchControls).toBe(true);
  });
});

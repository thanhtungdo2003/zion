import { useEffect, useSyncExternalStore } from 'react';
import { itemName, translate, translateMsg, type Lang, type Msg, type TKey } from './i18n';

/** User settings (language, audio) shared by the menu and the in-game pause screen. */
export type CameraMode = 'top-down' | 'first-person' | 'third-person';

export interface SettingsState {
  lang: Lang;
  /** Master volume 0…1, applied to the SoundBank gain. */
  volume: number;
  /** Scene exposure multiplier, 0.6…2. */
  brightness: number;
  /** Show the mobile joystick and touch action buttons. */
  touchControls: boolean;
  cameraMode: CameraMode;
  /** Mouse-look sensitivity, 1…100 (radians per pixel = value × 0.00004). */
  mouseSens: number;
}

const STORAGE_KEY = 'zion.settings.v1';
const DEFAULTS: SettingsState = { lang: 'en', volume: 0.8, brightness: 1.35, touchControls: false, cameraMode: 'top-down', mouseSens: 30 };

function load(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<SettingsState> & { firstPerson?: boolean };
    const state: SettingsState = { ...DEFAULTS };
    if (saved.lang === 'en' || saved.lang === 'vi') state.lang = saved.lang;
    if (typeof saved.volume === 'number' && Number.isFinite(saved.volume)) state.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved.brightness === 'number' && Number.isFinite(saved.brightness)) state.brightness = Math.min(2, Math.max(0.6, saved.brightness));
    if (typeof saved.mouseSens === 'number' && Number.isFinite(saved.mouseSens)) state.mouseSens = Math.min(100, Math.max(1, Math.round(saved.mouseSens)));
    if (saved.cameraMode === 'top-down' || saved.cameraMode === 'first-person' || saved.cameraMode === 'third-person') state.cameraMode = saved.cameraMode;
    else if (saved.firstPerson === true) state.cameraMode = 'first-person';
    if (typeof saved.touchControls === 'boolean') state.touchControls = saved.touchControls;
    return state;
  } catch {
    return DEFAULTS;
  }
}

export class SettingsStore {
  private state: SettingsState = DEFAULTS;
  private readonly listeners = new Set<() => void>();
  private loaded = false;

  get = (): SettingsState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Reads persisted settings once, after mount, so SSR and the first client render agree. */
  hydrate(): void {
    if (this.loaded || typeof localStorage === 'undefined') return;
    this.loaded = true;
    const state = load();
    if (state.lang !== this.state.lang || state.volume !== this.state.volume || state.brightness !== this.state.brightness || state.touchControls !== this.state.touchControls || state.cameraMode !== this.state.cameraMode || state.mouseSens !== this.state.mouseSens) this.set(state);
  }

  set(patch: Partial<SettingsState>): void {
    this.state = { ...this.state, ...patch };
    if (typeof document !== 'undefined') document.documentElement.lang = this.state.lang;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable: settings just aren't remembered */
    }
    for (const fn of this.listeners) fn();
  }
}

export const settingsStore = new SettingsStore();

/** Current settings plus `t(key)`, a translator bound to the active language. Re-renders on change. */
export function useSettings(): SettingsState & {
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  tm: (msg: Msg) => string;
  item: (id: string) => string;
} {
  const state = useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
  useEffect(() => settingsStore.hydrate(), []);
  const t = (key: TKey, vars?: Record<string, string | number>) => translate(state.lang, key, vars);
  return { ...state, t, tm: (msg: Msg) => translateMsg(state.lang, msg), item: (id: string) => itemName(state.lang, id) };
}

/** Points a gain node at the master-volume setting and keeps it in sync. Returns an unsubscribe fn. */
export function bindVolume(gain: { value: number }): () => void {
  gain.value = settingsStore.get().volume;
  return settingsStore.subscribe(() => {
    gain.value = settingsStore.get().volume;
  });
}

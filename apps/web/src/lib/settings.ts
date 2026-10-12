import { useEffect, useSyncExternalStore } from 'react';
import { itemName, translate, translateMsg, type Lang, type Msg, type TKey } from './i18n';

/** User settings (language, audio) shared by the menu and the in-game pause screen. */
export type CameraMode = 'top-down' | 'first-person' | 'third-person';
/** Keys not already used by movement, chat or another action. */
export const ROLL_KEYS = ['KeyQ', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyV', 'KeyB', 'KeyN', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyO', 'KeyY'] as const;
export type RollKey = typeof ROLL_KEYS[number];
export const PRONE_KEYS = ['KeyC', ...ROLL_KEYS] as const;
export type ProneKey = typeof PRONE_KEYS[number];
export function isProneKey(code: unknown): code is ProneKey { return PRONE_KEYS.some(key => key === code); }
export function isRollKey(code: unknown): code is RollKey { return ROLL_KEYS.some(key => key === code); }
export function rollKeyLabel(code: RollKey | ProneKey): string { return code.slice(3); }
export function cycleCameraMode(): void {
  const modes: CameraMode[] = ['top-down', 'third-person', 'first-person'];
  settingsStore.set({ cameraMode: modes[(modes.indexOf(settingsStore.get().cameraMode) + 1) % modes.length]! });
}

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
  rollKey: RollKey;
  proneKey: ProneKey;
}

const STORAGE_KEY = 'zion.settings.v1';
const DEFAULTS: SettingsState = { lang: 'vi', volume: 0.8, brightness: 1.35, touchControls: false, cameraMode: 'top-down', mouseSens: 30, rollKey: 'KeyQ', proneKey: 'KeyC' };

function load(): { state: SettingsState; manualTouch: boolean } {
  const defaults = { ...DEFAULTS, touchControls: typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: defaults, manualTouch: false };
    const saved = JSON.parse(raw) as Partial<SettingsState> & { firstPerson?: boolean; manualTouch?: boolean };
    const state: SettingsState = { ...defaults };
    if (isRollKey(saved.rollKey)) state.rollKey = saved.rollKey;
    if (isProneKey(saved.proneKey) && saved.proneKey !== state.rollKey) state.proneKey = saved.proneKey;
    // The playable UI and server-authored content currently ship in Vietnamese.
    // Migrate the old English default so returning players also see one language.
    state.lang = 'vi';
    if (typeof saved.volume === 'number' && Number.isFinite(saved.volume)) state.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved.brightness === 'number' && Number.isFinite(saved.brightness)) state.brightness = Math.min(2, Math.max(0.6, saved.brightness));
    if (typeof saved.mouseSens === 'number' && Number.isFinite(saved.mouseSens)) state.mouseSens = Math.min(100, Math.max(1, Math.round(saved.mouseSens)));
    if (saved.cameraMode === 'top-down' || saved.cameraMode === 'first-person' || saved.cameraMode === 'third-person') state.cameraMode = saved.cameraMode;
    else if (saved.firstPerson === true) state.cameraMode = 'first-person';
    // Older versions persisted the default false even without a user choice.
    const manualTouch = saved.manualTouch === true || (saved.manualTouch === undefined && saved.touchControls === true);
    if (manualTouch && typeof saved.touchControls === 'boolean') state.touchControls = saved.touchControls;
    return { state, manualTouch };
  } catch {
    return { state: defaults, manualTouch: false };
  }
}

export class SettingsStore {
  private state: SettingsState = DEFAULTS;
  private readonly listeners = new Set<() => void>();
  private loaded = false;
  private manualTouch = false;

  get = (): SettingsState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Reads persisted settings once, after mount, so SSR and the first client render agree. */
  hydrate(): void {
    if (this.loaded || typeof window === 'undefined' && typeof localStorage === 'undefined') return;
    this.loaded = true;
    const { state, manualTouch } = load();
    this.manualTouch = manualTouch;
    this.state = state;
    if (typeof document !== 'undefined') document.documentElement.lang = state.lang;
    for (const fn of this.listeners) fn();
  }

  set(patch: Partial<SettingsState>): void {
    const nextRoll = patch.rollKey ?? this.state.rollKey, nextProne = patch.proneKey ?? this.state.proneKey;
    if (!isRollKey(nextRoll) || !isProneKey(nextProne) || nextRoll === nextProne) return;
    if (typeof patch.touchControls === 'boolean') this.manualTouch = true;
    this.state = { ...this.state, ...patch };
    if (typeof document !== 'undefined') document.documentElement.lang = this.state.lang;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.state, manualTouch: this.manualTouch }));
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

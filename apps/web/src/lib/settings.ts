import { useEffect, useSyncExternalStore } from 'react';
import type { GameMode } from '@zion/shared';
import { itemName, translate, translateMsg, type Lang, type Msg, type TKey } from './i18n';

/** User settings (language, audio) shared by the menu and the in-game pause screen. */
export type CameraMode = 'top-down' | 'first-person' | 'third-person';
/** Keys not already used by movement, chat or another action. */
export const ROLL_KEYS = ['KeyV', 'KeyF', 'KeyG', 'KeyZ', 'KeyB', 'KeyN', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyO', 'KeyY'] as const;
export type RollKey = typeof ROLL_KEYS[number];
export const PRONE_KEYS = ['KeyC', ...ROLL_KEYS] as const;
export type ProneKey = typeof PRONE_KEYS[number];
export function isProneKey(code: unknown): code is ProneKey { return PRONE_KEYS.some(key => key === code); }
export function isRollKey(code: unknown): code is RollKey { return ROLL_KEYS.some(key => key === code); }
export function rollKeyLabel(code: RollKey | ProneKey): string { return code.slice(3); }
/** Attachment screen and night-vision switch: Alt / M by default, or a free letter key. */
export const ATTACH_KEYS = ['AltLeft', 'KeyB', 'KeyN', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyO', 'KeyY'] as const;
export type AttachKey = typeof ATTACH_KEYS[number];
export const NV_KEYS = ['KeyM', 'KeyN', 'KeyB', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyO', 'KeyY'] as const;
export type NvKey = typeof NV_KEYS[number];
export function keyLabel(code: string): string { return code === 'AltLeft' ? 'Alt' : code === 'CapsLock' ? 'Caps' : code.replace(/^Key/, ''); }
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
  attachKey: AttachKey;
  nvKey: NvKey;
  /** Graphics: internal resolution 0.5…1, shadow quality, draw distance 0.4…1, grass 0…1. */
  renderScale: number;
  shadows: ShadowQuality;
  drawDistance: number;
  grassDensity: number;
  /** Shader pack: ambient occlusion, bloom, sun shafts, soft shadows and a cinematic grade. */
  shaders: boolean;
  /** Things right in front of the eye (gun, hands) out of focus in first person. */
  nearBlur: boolean;
  /** Photographed ground materials: off, or 256 / 512 / 1024 px layers. */
  groundDetail: GroundDetail;
  /** Clothing textures: as shipped (high), or downscaled to 512 / 256 px. */
  textureQuality: TextureQuality;
  /** Team voice: teammates' loudness 0…1, push-to-talk (else the mic opens on its own) and its key. */
  voiceVolume: number;
  voicePtt: boolean;
  voiceKey: VoiceKey;
}

export const VOICE_KEYS = ['KeyZ', 'KeyB', 'KeyN', 'CapsLock'] as const;
export type VoiceKey = (typeof VOICE_KEYS)[number];

export type GroundDetail = 'off' | 'low' | 'medium' | 'high';
export type TextureQuality = 'low' | 'medium' | 'high';
export const TEXTURE_QUALITIES: readonly TextureQuality[] = ['low', 'medium', 'high'];
export const GROUND_DETAILS: readonly GroundDetail[] = ['off', 'low', 'medium', 'high'];

export type ShadowQuality = 'off' | 'low' | 'high';
export type GraphicsPreset = 'low' | 'medium' | 'high';
/** Presets trade picture quality for smoothness on weaker machines. */
export const GRAPHICS_PRESETS: Record<GraphicsPreset, Pick<SettingsState, 'renderScale' | 'shadows' | 'drawDistance' | 'grassDensity'>> = {
  low: { renderScale: .6, shadows: 'off', drawDistance: .5, grassDensity: .2 },
  medium: { renderScale: .8, shadows: 'low', drawDistance: .75, grassDensity: .55 },
  high: { renderScale: 1, shadows: 'high', drawDistance: 1, grassDensity: 1 },
};
export function graphicsPreset(s: SettingsState): GraphicsPreset | null {
  return (Object.keys(GRAPHICS_PRESETS) as GraphicsPreset[]).find(k => { const p = GRAPHICS_PRESETS[k]; return p.renderScale === s.renderScale && p.shadows === s.shadows && p.drawDistance === s.drawDistance && p.grassDensity === s.grassDensity; }) ?? null;
}

const STORAGE_KEY = 'zion.settings.v1';
const DEFAULTS: SettingsState = { lang: 'vi', volume: 0.8, brightness: 1.15, touchControls: false, cameraMode: 'first-person', mouseSens: 30, rollKey: 'KeyV', proneKey: 'KeyC', attachKey: 'AltLeft', nvKey: 'KeyM', shaders: false, nearBlur: true, textureQuality: 'high', voiceVolume: 1, voicePtt: false, voiceKey: 'KeyZ',
  // The desktop app ships every texture locally: full 1024 px ground; the browser 512 px.
  groundDetail: process.env.NEXT_PUBLIC_API_URL === 'same-origin' ? 'high' : 'medium', ...GRAPHICS_PRESETS.high };

function load(): { state: SettingsState; manualTouch: boolean } {
  const defaults = { ...DEFAULTS, touchControls: typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: defaults, manualTouch: false };
    const saved = JSON.parse(raw) as Partial<SettingsState> & { firstPerson?: boolean; manualTouch?: boolean };
    const state: SettingsState = { ...defaults };
    if (isRollKey(saved.rollKey)) state.rollKey = saved.rollKey;
    if (isProneKey(saved.proneKey) && saved.proneKey !== state.rollKey) state.proneKey = saved.proneKey;
    if (ATTACH_KEYS.some((k) => k === saved.attachKey)) state.attachKey = saved.attachKey!;
    if (NV_KEYS.some((k) => k === saved.nvKey)) state.nvKey = saved.nvKey!;
    // The playable UI and server-authored content currently ship in Vietnamese.
    // Migrate the old English default so returning players also see one language.
    state.lang = 'vi';
    if (typeof saved.volume === 'number' && Number.isFinite(saved.volume)) state.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved.brightness === 'number' && Number.isFinite(saved.brightness)) state.brightness = Math.min(2, Math.max(0.6, saved.brightness));
    const clamp01 = (v: unknown, lo: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(lo, v)) : fallback;
    state.renderScale = clamp01(saved.renderScale, .5, state.renderScale);
    state.drawDistance = clamp01(saved.drawDistance, .4, state.drawDistance);
    if (TEXTURE_QUALITIES.some((q) => q === saved.textureQuality)) state.textureQuality = saved.textureQuality!;
    state.grassDensity = clamp01(saved.grassDensity, 0, state.grassDensity);
    if (saved.shadows === 'off' || saved.shadows === 'low' || saved.shadows === 'high') state.shadows = saved.shadows;
    if (typeof saved.shaders === 'boolean') state.shaders = saved.shaders;
    if (typeof saved.nearBlur === 'boolean') state.nearBlur = saved.nearBlur;
    state.voiceVolume = clamp01(saved.voiceVolume, 0, state.voiceVolume);
    if (typeof saved.voicePtt === 'boolean') state.voicePtt = saved.voicePtt;
    if (VOICE_KEYS.some((k) => k === saved.voiceKey)) state.voiceKey = saved.voiceKey!;
    if (GROUND_DETAILS.includes(saved.groundDetail as GroundDetail)) state.groundDetail = saved.groundDetail!;
    if (typeof saved.mouseSens === 'number' && Number.isFinite(saved.mouseSens)) state.mouseSens = Math.min(100, Math.max(1, Math.round(saved.mouseSens)));
    if (saved.cameraMode === 'top-down' || saved.cameraMode === 'first-person' || saved.cameraMode === 'third-person') state.cameraMode = saved.cameraMode;
    else if (saved.firstPerson === true) state.cameraMode = 'first-person';
    else if (saved.firstPerson === false) state.cameraMode = 'top-down';
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
  private mode: GameMode = 'survival';
  private cameras: Record<GameMode, CameraMode> = { survival: 'first-person', 'battle-royale': 'first-person', infection: 'first-person', waves: 'first-person' };

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
    this.cameras.survival = state.cameraMode;
    try {
      const saved = JSON.parse(localStorage.getItem('zion.camera.v1') ?? '{}') as Record<string, unknown>;
      const battle = saved['battle-royale'];
      if (battle === 'first-person' || battle === 'third-person' || battle === 'top-down') this.cameras['battle-royale'] = battle;
      const infection = saved.infection;
      if (infection === 'first-person' || infection === 'third-person' || infection === 'top-down') this.cameras.infection = infection;
    } catch { /* keep the first-person BR default */ }
    this.state = { ...state, cameraMode: this.cameras[this.mode] };
    if (typeof document !== 'undefined') document.documentElement.lang = state.lang;
    for (const fn of this.listeners) fn();
  }

  setGameMode(mode: GameMode): void {
    this.hydrate();
    if (mode === this.mode) return;
    this.mode = mode;
    this.state = { ...this.state, cameraMode: this.cameras[mode] };
    for (const fn of this.listeners) fn();
  }

  set(patch: Partial<SettingsState>): void {
    const nextRoll = patch.rollKey ?? this.state.rollKey, nextProne = patch.proneKey ?? this.state.proneKey;
    if (!isRollKey(nextRoll) || !isProneKey(nextProne) || nextRoll === nextProne) return;
    if (typeof patch.touchControls === 'boolean') this.manualTouch = true;
    this.state = { ...this.state, ...patch };
    if (patch.cameraMode) this.cameras[this.mode] = patch.cameraMode;
    if (typeof document !== 'undefined') document.documentElement.lang = this.state.lang;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.state, cameraMode: this.cameras.survival, manualTouch: this.manualTouch }));
      localStorage.setItem('zion.camera.v1', JSON.stringify(this.cameras));
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

'use client';
import { Icon } from './Icon';

import { ATTACH_KEYS, NV_KEYS, keyLabel, GRAPHICS_PRESETS, GROUND_DETAILS, TEXTURE_QUALITIES, graphicsPreset, type GraphicsPreset } from '@/lib/settings';
import { useEffect, useState, type ReactNode } from 'react';
import { isRollKey, isProneKey, PRONE_KEYS, ROLL_KEYS, rollKeyLabel, settingsStore, useSettings } from '@/lib/settings';
import type { Lang } from '@/lib/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  onCameraChange?: () => void;
  /** Rendered under the language row (extra sections contributed by the host screen). */
  children?: ReactNode;
}

const LANGS: Array<{ id: Lang; label: string; native: string }> = [
  { id: 'vi', label: 'Tiếng Việt', native: 'VIE' },
];

/** Flat, hard-edged settings panel: language switch, master volume, host-provided sections. */
export function SettingsModal({ open, onClose, onCameraChange, children }: Props) {
  const [tab, setTab] = useState<'general' | 'controls' | 'display'>('general');
  const settings = useSettings();
  const { lang, volume, brightness, touchControls, cameraMode, mouseSens, rollKey, proneKey, attachKey, nvKey, renderScale, shadows, drawDistance, grassDensity, shaders, groundDetail, textureQuality, t } = settings;
  const preset = graphicsPreset(settings);

  useEffect(() => {
    if (!open) setTab('general');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="set-overlay" role="dialog" aria-modal="true" aria-label={t('settings.title')} onClick={onClose}>
      <div className="set-panel" onClick={(e) => e.stopPropagation()}>
        <header className="set-head">
          <div>
            <small>ZION // {t('settings.system')}</small>
            <h2>{t('settings.title')}</h2>
          </div>
          <span className="set-badge">v1.0</span>
        </header>

        <div className="set-tabs" role="tablist" aria-label={t('settings.title')}>
          {(['general', 'controls', 'display'] as const).map(id => (
            <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-selected={tab === id}
              aria-controls={`settings-panel-${id}`} onClick={() => setTab(id)}>
              {t(id === 'general' ? 'settings.general' : id === 'controls' ? 'settings.controls_tab' : 'settings.display_tab')}
            </button>
          ))}
        </div>

        {tab === 'general' && <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general">

        <section className="set-section">
          <h3>
            <span>01</span> {t('settings.language')}
          </h3>
          <div className="set-langs" role="radiogroup" aria-label={t('settings.language')}>
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={lang === l.id}
                className="set-lang"
                onClick={() => settingsStore.set({ lang: l.id })}
              >
                <b>{l.native}</b>
                <small>{l.label}</small>
                <i aria-hidden><Icon name={lang === l.id ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
        </section>

        <section className="set-section">
          <h3>
            <span>02</span> {t('settings.audio')}
          </h3>
          <label className="set-slider">
            <span>{t('settings.volume')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => settingsStore.set({ volume: Number(e.target.value) / 100 })}
            />
            <em>{Math.round(volume * 100)}%</em>
          </label>
        </section>

        <section className="set-section">
          <h3>
            <span>03</span> {t('settings.view')}
          </h3>
          <div className="set-langs set-camera" role="radiogroup" aria-label={t('settings.view')}>
            {(['top-down', 'third-person', 'first-person'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={cameraMode === mode}
                className="set-lang"
                onClick={() => { settingsStore.set({ cameraMode: mode }); onClose(); onCameraChange?.(); }}
              >
                <b>{mode === 'first-person' ? 'FPP' : mode === 'third-person' ? 'TPP' : 'TOP'}</b>
                <small>{t(mode === 'first-person' ? 'settings.view_first' : mode === 'third-person' ? 'settings.view_shoulder' : 'settings.view_third')}</small>
                <i aria-hidden><Icon name={cameraMode === mode ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
          <p className="set-camera-hint"><kbd>P</kbd> {t('keys.camera')}</p>
        </section>

        {children}
        </div>}

        {tab === 'display' && <div role="tabpanel" id="settings-panel-display" aria-labelledby="settings-tab-display">
        <section className="set-section">
          <h3>
            <span>01</span> {t('settings.display')}
          </h3>
          <label className="set-slider">
            <span>{t('settings.brightness')}</span>
            <input
              type="range"
              min={60}
              max={200}
              step={5}
              value={Math.round(brightness * 100)}
              onChange={(e) => settingsStore.set({ brightness: Number(e.target.value) / 100 })}
            />
            <em>{Math.round(brightness * 100)}%</em>
          </label>
        </section>
        <section className="set-section">
          <h3><span>02</span> Chất lượng đồ họa</h3>
          <div className="set-langs set-camera" role="radiogroup" aria-label="Mức đồ họa">
            {(['low', 'medium', 'high'] as GraphicsPreset[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={preset === p} className="set-lang" onClick={() => settingsStore.set(GRAPHICS_PRESETS[p])}>
                <b>{p === 'low' ? 'THẤP' : p === 'medium' ? 'VỪA' : 'CAO'}</b>
                <small>{p === 'low' ? 'Mượt nhất · máy yếu' : p === 'medium' ? 'Cân bằng' : 'Đẹp nhất'}</small>
                <i aria-hidden><Icon name={preset === p ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
          <label className="set-slider">
            <span>Độ phân giải</span>
            <input type="range" min={50} max={100} step={5} value={Math.round(renderScale * 100)} onChange={(e) => settingsStore.set({ renderScale: Number(e.target.value) / 100 })} />
            <em>{Math.round(renderScale * 100)}%</em>
          </label>
          <label className="set-slider">
            <span>Tầm nhìn vật thể</span>
            <input type="range" min={40} max={100} step={5} value={Math.round(drawDistance * 100)} onChange={(e) => settingsStore.set({ drawDistance: Number(e.target.value) / 100 })} />
            <em>{Math.round(drawDistance * 100)}%</em>
          </label>
          <label className="set-slider">
            <span>Mật độ cỏ</span>
            <input type="range" min={0} max={100} step={5} value={Math.round(grassDensity * 100)} onChange={(e) => settingsStore.set({ grassDensity: Number(e.target.value) / 100 })} />
            <em>{Math.round(grassDensity * 100)}%</em>
          </label>
          <div className="set-langs set-camera" role="radiogroup" aria-label="Đổ bóng">
            {(['off', 'low', 'high'] as const).map((q) => (
              <button key={q} type="button" role="radio" aria-checked={shadows === q} className="set-lang" onClick={() => settingsStore.set({ shadows: q })}>
                <b>{q === 'off' ? 'TẮT BÓNG' : q === 'low' ? 'BÓNG THẤP' : 'BÓNG CAO'}</b>
                <small>{q === 'off' ? 'Nhẹ GPU nhất' : q === 'low' ? 'Bóng mờ, nhẹ' : 'Bóng sắc nét'}</small>
                <i aria-hidden><Icon name={shadows === q ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
          <div className="set-langs set-camera set-ground" role="radiogroup" aria-label="Chất liệu mặt đất">
            {GROUND_DETAILS.map((q) => (
              <button key={q} type="button" role="radio" aria-checked={groundDetail === q} className="set-lang" onClick={() => settingsStore.set({ groundDetail: q })}>
                <b>{q === 'off' ? 'ĐẤT TRƠN' : q === 'low' ? 'ĐẤT THẤP' : q === 'medium' ? 'ĐẤT VỪA' : 'ĐẤT CAO'}</b>
                <small>{q === 'off' ? 'Mặt đất màu, nhẹ nhất' : q === 'low' ? 'Chất liệu 256 px' : q === 'medium' ? 'Chất liệu 512 px' : 'Chất liệu 1024 px · nét nhất'}</small>
                <i aria-hidden><Icon name={groundDetail === q ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
          <div className="set-langs set-camera" role="radiogroup" aria-label="Chất lượng texture trang phục">
            {TEXTURE_QUALITIES.map((q) => (
              <button key={q} type="button" role="radio" aria-checked={textureQuality === q} className="set-lang" onClick={() => settingsStore.set({ textureQuality: q })}>
                <b>{q === 'low' ? 'TEXTURE THẤP' : q === 'medium' ? 'TEXTURE VỪA' : 'TEXTURE CAO'}</b>
                <small>{q === 'low' ? 'Trang phục 256 px, nhẹ nhất' : q === 'medium' ? 'Trang phục 512 px' : 'Giữ nguyên texture gốc'}</small>
                <i aria-hidden><Icon name={textureQuality === q ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
          <div className="set-langs set-camera" role="radiogroup" aria-label="Shader ánh sáng">
            {([false, true] as const).map((on) => (
              <button key={String(on)} type="button" role="radio" aria-checked={shaders === on} className="set-lang" onClick={() => settingsStore.set({ shaders: on })}>
                <b>{on ? 'SHADER BẬT' : 'SHADER TẮT'}</b>
                <small>{on ? 'Bóng mềm, ánh sáng toả, tia nắng, AO · nặng GPU' : 'Hình ảnh thường, nhẹ máy'}</small>
                <i aria-hidden><Icon name={shaders === on ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
        </section>
        </div>}

        {tab === 'controls' && <div role="tabpanel" id="settings-panel-controls" aria-labelledby="settings-tab-controls">
        <section className="set-section">
          <h3><span>01</span> {t('settings.controls')}</h3>
          <label className="set-keybind">
            <span>{t('settings.roll_key')}</span>
            <select value={rollKey} onChange={(e) => { if (isRollKey(e.target.value)) settingsStore.set({ rollKey: e.target.value }); }}>
              {ROLL_KEYS.map(code => <option key={code} value={code} disabled={code === proneKey}>{rollKeyLabel(code)}</option>)}
            </select>
          </label>
          <label className="set-keybind">
            <span>{t('settings.prone_key')}</span>
            <select value={proneKey} onChange={e => { if (isProneKey(e.target.value)) settingsStore.set({ proneKey: e.target.value }); }}>
              {PRONE_KEYS.map(code => <option key={code} value={code} disabled={code === rollKey}>{rollKeyLabel(code)}</option>)}
            </select>
          </label>
          <label className="set-keybind">
            <span>Phụ kiện súng</span>
            <select value={attachKey} onChange={e => { const v = ATTACH_KEYS.find(k => k === e.target.value); if (v) settingsStore.set({ attachKey: v }); }}>
              {ATTACH_KEYS.map(code => <option key={code} value={code} disabled={code === rollKey || code === proneKey}>{keyLabel(code)}</option>)}
            </select>
          </label>
          <label className="set-keybind">
            <span>Nhìn đêm (trong ống ngắm)</span>
            <select value={nvKey} onChange={e => { const v = NV_KEYS.find(k => k === e.target.value); if (v) settingsStore.set({ nvKey: v }); }}>
              {NV_KEYS.map(code => <option key={code} value={code} disabled={code === rollKey || code === proneKey || code === attachKey}>{keyLabel(code)}</option>)}
            </select>
          </label>
          <label className="set-slider" style={{ marginBottom: 12 }}>
            <span>{t('settings.sensitivity')}</span>
            <input type="range" min={1} max={100} value={mouseSens} onChange={(e) => settingsStore.set({ mouseSens: Number(e.target.value) })} />
            <em>{mouseSens}</em>
          </label>
          <button type="button" className="set-touch-toggle" role="switch" aria-checked={touchControls} onClick={() => settingsStore.set({ touchControls: !touchControls })}>
            <Icon name="lucide:smartphone" />
            <span>{t('settings.touch_controls')}</span>
            <Icon name={touchControls ? 'lucide:toggle-right' : 'lucide:toggle-left'} />
          </button>
        </section>
        </div>}

        <footer className="set-foot">
          <kbd>ESC</kbd> {t('settings.close_hint')}
          <button type="button" className="btn" onClick={onClose}>
            {t('settings.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}

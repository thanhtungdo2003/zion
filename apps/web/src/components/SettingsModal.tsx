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

/** A percentage slider row (the setting is a 0–1+ fraction). */
function Range({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return <label className="set-slider">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={5} value={pct} onChange={(e) => onChange(Number(e.target.value) / 100)} />
    <em>{pct}%</em>
  </label>;
}

/** A labelled segmented choice; the chosen option's note sits beside the label. */
function Choice<T extends string | boolean>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string; hint: string }>; onChange: (v: T) => void }) {
  const current = options.find((o) => o.id === value);
  return <div className="set-choice">
    <div className="set-choice-head"><span>{label}</span><small>{current?.hint}</small></div>
    <div className="set-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={String(o.id)} type="button" role="radio" aria-checked={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  </div>;
}

/** Flat, hard-edged settings panel: language switch, master volume, host-provided sections. */
export function SettingsModal({ open, onClose, onCameraChange, children }: Props) {
  const [tab, setTab] = useState<'general' | 'controls' | 'display'>('general');
  const settings = useSettings();
  const { lang, volume, brightness, touchControls, cameraMode, mouseSens, rollKey, proneKey, attachKey, nvKey, renderScale, shadows, drawDistance, grassDensity, shaders, nearBlur, groundDetail, textureQuality, t } = settings;
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
          <h3><span>01</span> Mức đồ họa</h3>
          <div className="set-langs set-camera" role="radiogroup" aria-label="Mức đồ họa">
            {(['low', 'medium', 'high'] as GraphicsPreset[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={preset === p} className="set-lang" onClick={() => settingsStore.set(GRAPHICS_PRESETS[p])}>
                <b>{p === 'low' ? 'THẤP' : p === 'medium' ? 'VỪA' : 'CAO'}</b>
                <small>{p === 'low' ? 'Mượt nhất' : p === 'medium' ? 'Cân bằng' : 'Đẹp nhất'}</small>
                <i aria-hidden><Icon name={preset === p ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
          {!preset && <p className="set-camera-hint">Đang dùng thiết lập riêng bên dưới.</p>}
        </section>
        <section className="set-section">
          <h3><span>02</span> {t('settings.display')}</h3>
          <div className="set-rows">
            <Range label={t('settings.brightness')} min={60} max={200} value={brightness} onChange={(v) => settingsStore.set({ brightness: v })} />
            <Range label="Độ phân giải" min={50} max={100} value={renderScale} onChange={(v) => settingsStore.set({ renderScale: v })} />
            <Range label="Tầm nhìn" min={40} max={100} value={drawDistance} onChange={(v) => settingsStore.set({ drawDistance: v })} />
            <Range label="Mật độ cỏ" min={0} max={100} value={grassDensity} onChange={(v) => settingsStore.set({ grassDensity: v })} />
          </div>
        </section>
        <section className="set-section">
          <h3><span>03</span> Chi tiết</h3>
          <div className="set-rows">
            <Choice label="Đổ bóng" value={shadows} onChange={(q) => settingsStore.set({ shadows: q })} options={[
              { id: 'off', label: 'Tắt', hint: 'Nhẹ GPU nhất' }, { id: 'low', label: 'Thấp', hint: 'Bóng mờ, nhẹ' }, { id: 'high', label: 'Cao', hint: 'Bóng sắc nét' }]} />
            <Choice label="Mặt đất" value={groundDetail} onChange={(q) => settingsStore.set({ groundDetail: q })} options={GROUND_DETAILS.map((q) => (
              { id: q, label: q === 'off' ? 'Trơn' : q === 'low' ? 'Thấp' : q === 'medium' ? 'Vừa' : 'Cao', hint: q === 'off' ? 'Mặt đất màu, nhẹ nhất' : q === 'low' ? 'Chất liệu 256 px' : q === 'medium' ? 'Chất liệu 512 px' : 'Chất liệu 1024 px · nét nhất' }))} />
            <Choice label="Texture trang phục" value={textureQuality} onChange={(q) => settingsStore.set({ textureQuality: q })} options={TEXTURE_QUALITIES.map((q) => (
              { id: q, label: q === 'low' ? 'Thấp' : q === 'medium' ? 'Vừa' : 'Cao', hint: q === 'low' ? '256 px, nhẹ nhất' : q === 'medium' ? '512 px' : 'Giữ nguyên texture gốc' }))} />
          </div>
        </section>
        <section className="set-section">
          <h3><span>04</span> Hiệu ứng</h3>
          <div className="set-rows">
            <Choice label="Shader ánh sáng" value={shaders} onChange={(on) => settingsStore.set({ shaders: on })} options={[
              { id: false, label: 'Tắt', hint: 'Hình ảnh thường, nhẹ máy' }, { id: true, label: 'Bật', hint: 'Bóng mềm, ánh sáng toả, tia nắng, AO · nặng GPU' }]} />
            <Choice label="Mờ vật gần mắt" value={nearBlur} onChange={(on) => settingsStore.set({ nearBlur: on })} options={[
              { id: false, label: 'Tắt', hint: 'Mọi thứ đều nét' }, { id: true, label: 'Bật', hint: 'Súng, tay sát mắt hơi nhoè' }]} />
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

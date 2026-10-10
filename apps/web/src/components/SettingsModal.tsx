'use client';
import { Icon } from './Icon';

import { useEffect, type ReactNode } from 'react';
import { settingsStore, useSettings } from '@/lib/settings';
import type { Lang } from '@/lib/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Rendered under the language row (extra sections contributed by the host screen). */
  children?: ReactNode;
}

const LANGS: Array<{ id: Lang; label: string; native: string }> = [
  { id: 'en', label: 'English', native: 'ENG' },
  { id: 'vi', label: 'Tiếng Việt', native: 'VIE' },
];

/** Flat, hard-edged settings panel: language switch, master volume, host-provided sections. */
export function SettingsModal({ open, onClose, children }: Props) {
  const { lang, volume, brightness, firstPerson, mouseSens, t } = useSettings();

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
            <small>ZION // System</small>
            <h2>{t('settings.title')}</h2>
          </div>
          <span className="set-badge">v1.0</span>
        </header>

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
          <div className="set-langs" role="radiogroup" aria-label={t('settings.view')}>
            {([false, true] as const).map((fp) => (
              <button
                key={String(fp)}
                type="button"
                role="radio"
                aria-checked={firstPerson === fp}
                className="set-lang"
                onClick={() => settingsStore.set({ firstPerson: fp })}
              >
                <b>{fp ? 'FPP' : 'TPP'}</b>
                <small>{t(fp ? 'settings.view_first' : 'settings.view_third')}</small>
                <i aria-hidden><Icon name={firstPerson === fp ? 'lucide:square-check' : 'lucide:square'} /></i>
              </button>
            ))}
          </div>
          <label className="set-slider" style={{ marginTop: 12 }}>
            <span>{t('settings.sensitivity')}</span>
            <input type="range" min={1} max={100} value={mouseSens} onChange={(e) => settingsStore.set({ mouseSens: Number(e.target.value) })} />
            <em>{mouseSens}</em>
          </label>
        </section>

        <section className="set-section">
          <h3>
            <span>04</span> {t('settings.display')}
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

        {children}

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

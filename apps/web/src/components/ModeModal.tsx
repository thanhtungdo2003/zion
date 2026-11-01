'use client';
import { useEffect, useRef } from 'react';
import type { GameMode } from '@zion/shared';
import { useSettings } from '@/lib/settings';
import type { TKey } from '@/lib/i18n';
import { Icon } from './Icon';

export interface ModeOption { id: GameMode; name: TKey; sub: TKey; image: string; icon: string; isNew?: boolean }

/**
 * Game-mode picker: a large modal laid out as an asymmetric bento (one tall tile, two stacked),
 * each tile a full-bleed key art with the mode's name over it.
 */
export function ModeModal({ modes, current, onPick, onClose }: { modes: readonly ModeOption[]; current: GameMode; onPick: (mode: GameMode) => void; onClose: () => void }) {
  const { t } = useSettings();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="mode-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} className="mode-modal" role="dialog" aria-modal="true" aria-labelledby="mode-modal-title">
        <header>
          <h2 id="mode-modal-title">{t('mode.pick')}</h2>
          <button type="button" className="inv-close" aria-label="Đóng" onClick={onClose}><Icon name="lucide:x" /></button>
        </header>
        <div className="mode-bento" role="radiogroup" aria-labelledby="mode-modal-title">
          {modes.map((m, i) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === current}
              className={`mode-tile mode-tile-${i}${m.id === current ? ' on' : ''}`}
              style={{ backgroundImage: `url(${m.image})` }} title={t(m.sub)}
              onClick={() => { onPick(m.id); onClose(); }}>
              {m.isNew && <span className="mode-tile-new">{t('mode.new')}</span>}
              {m.id === current && <span className="mode-tile-check"><Icon name="lucide:check" /></span>}
              <span className="mode-tile-text">
                <Icon name={m.icon} className="mode-tile-icon" />
                <b>{t(m.name)}</b>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { listBattleMaps, type BattleMapInfo } from '@/lib/api';
import { Icon } from './Icon';

/**
 * Battle royale map picker: a large panel, a 3 × 3 grid of maps (paged when there are more), each
 * tile showing the map itself as its background and how many people are playing on it right now.
 */
export function MapPicker({ current, fallbackImage, onPick, onClose }: { current: string; fallbackImage: string; onPick: (id: string, name: string) => void; onClose: () => void }) {
  const [maps, setMaps] = useState<BattleMapInfo[] | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const load = () => listBattleMaps().then((m) => { if (alive) { setMaps(m); setError(null); } }).catch((e: unknown) => { if (alive) setError((e as Error).message); });
    void load();
    const t = window.setInterval(load, 8000);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const list = maps ?? [], pages = Math.max(1, Math.ceil(list.length / 9)), shown = list.slice(page * 9, page * 9 + 9);
  return (
    <div className="mode-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} className="mode-modal map-picker" role="dialog" aria-modal="true" aria-labelledby="map-picker-title">
        <header>
          <h2 id="map-picker-title">Chọn bản đồ</h2>
          <button type="button" className="inv-close" aria-label="Đóng" onClick={onClose}><Icon name="lucide:x" /></button>
        </header>
        {error && <p className="map-picker-note">Không tải được danh sách bản đồ: {error}</p>}
        {!maps && !error && <p className="map-picker-note">Đang tải…</p>}
        <div className="map-grid" role="radiogroup" aria-labelledby="map-picker-title">
          {shown.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === current} className={`map-tile${m.id === current ? ' on' : ''}`}
              style={{ backgroundImage: `url(${m.thumbnail ?? fallbackImage})` }}
              onClick={() => { onPick(m.id, m.name); onClose(); }}>
              {m.id === current && <span className="mode-tile-check"><Icon name="lucide:check" /></span>}
              <span className="map-tile-players"><Icon name="lucide:users" />{m.players} đang chơi</span>
              <span className="map-tile-text"><b>{m.name}</b><small>{m.builtin ? 'Mặc định' : `${m.matches} trận đang mở`}</small></span>
            </button>
          ))}
          {Array.from({ length: Math.max(0, 9 - shown.length) }, (_, i) => <span key={`empty-${i}`} className="map-tile empty" aria-hidden="true" />)}
        </div>
        {pages > 1 && <div className="map-pages">
          <button type="button" className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="lucide:chevron-left" /></button>
          <span>{page + 1} / {pages}</span>
          <button type="button" className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><Icon name="lucide:chevron-right" /></button>
        </div>}
      </div>
    </div>
  );
}

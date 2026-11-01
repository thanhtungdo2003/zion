'use client';
import { BATTLE_MAP } from '@zion/shared';
import type { HudState } from '@/game/hud-store';
import { Icon } from './Icon';

type Row = HudState['scorePlayers'][number] & { place: number | null };

/**
 * Battle royale results: shown when you are knocked out of the match and when the match ends.
 * A placement header, your numbers, and the match standings (winning side first, then everyone in
 * the order they went out), with you highlighted.
 */
export function BattleResults({ hud, onLeave, onSpectate }: { hud: HudState; onLeave(): void; onSpectate?(): void }) {
  const battle = hud.battle!;
  const finished = battle.phase === 'finished';
  const placements = battle.placements ?? {};
  const rows: Row[] = hud.scorePlayers.map((p) => ({ ...p, place: placements[p.id] ?? null }));
  // Still fighting (no place yet) above those already out; then by place, then by kills.
  rows.sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || b.kills - a.kills || a.name.localeCompare(b.name));
  const me = rows.find((r) => r.id === hud.selfId);
  const place = battle.placement ?? me?.place ?? null;
  const won = place === 1;
  const killer = hud.spectatingKiller ? hud.spectating : null;
  const seconds = Math.ceil(battle.remainingMs / 1000);
  const title = won ? 'CHIẾN THẮNG' : finished ? 'TRẬN ĐẤU KẾT THÚC' : 'BẠN ĐÃ BỊ LOẠI';
  const line = won
    ? battle.winner?.squad ? `Tiểu đội ${battle.winner.name} trụ lại cuối cùng.` : 'Bạn là người sống sót cuối cùng.'
    : finished
      ? battle.winner ? battle.winner.squad ? `Tiểu đội ${battle.winner.name} giành chiến thắng.` : `${battle.winner.name} giành chiến thắng.` : 'Không ai sống sót.'
      : killer ? `Bị hạ bởi ${killer}.` : 'Bạn đã bị loại khỏi trận.';
  return (
    <div className={`br-results${won ? ' won' : ''}`} role="dialog" aria-label="Kết quả trận">
      <div className="br-results-card">
        <header className="br-results-head">
          <div className="br-results-place">
            <small>HẠNG</small>
            <b>#{place ?? '—'}</b>
            <span>/ {battle.total}</span>
          </div>
          <div className="br-results-title">
            <small>{BATTLE_MAP.name}</small>
            <h2>{title}</h2>
            <p>{line}</p>
          </div>
        </header>
        <div className="br-results-stats">
          <div title="Hạ gục"><small><Icon name="game-icons:skull-crossed-bones" /> Hạ gục</small><b>{me?.kills ?? 0}</b></div>
          <div title="Hạng"><small><Icon name="lucide:trophy" /> Hạng</small><b>{place ? `#${place}` : '—'}</b></div>
          <div title="Còn sống"><small><Icon name="lucide:heart-pulse" /> Còn sống</small><b>{finished ? (won ? battle.alive : 0) : battle.alive}</b></div>
          <div title="Người tham gia"><small><Icon name="lucide:users" /> Tổng</small><b>{battle.total}</b></div>
        </div>
        <div className="br-results-table" role="table" aria-label="Bảng xếp hạng">
          <div className="br-row br-row-head" role="row"><span>Hạng</span><span>Người chơi</span><span>Hạ gục</span><span>Trạng thái</span></div>
          <div className="br-rows">
            {rows.map((r) => (
              <div key={r.id} role="row" className={`br-row${r.id === hud.selfId ? ' self' : ''}${r.place === 1 ? ' winner' : ''}${r.place === null ? ' alive' : ''}`}>
                <span className="br-place">{r.place ? `#${r.place}` : '—'}</span>
                <span className="br-name"><b>{r.name}</b>{r.bot && <i>BOT</i>}{r.id === hud.selfId && <em>BẠN</em>}</span>
                <span className="br-kills">{r.kills}</span>
                <span className="br-state">{r.place === 1 ? 'Chiến thắng' : r.place ? 'Bị loại' : 'Đang chiến đấu'}</span>
              </div>
            ))}
          </div>
        </div>
        <footer className="br-results-actions">
          {!finished && onSpectate && <button className="btn" onClick={onSpectate}><Icon name="lucide:eye" /> Theo dõi</button>}
          <button className="btn btn-primary" onClick={onLeave}>Về sảnh</button>
          {finished && <small title="Tự đóng trận"><Icon name="lucide:timer" /> {seconds}s</small>}
        </footer>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import type { LeaderboardView } from '@zion/shared';
import { getLeaderboard } from '@/lib/api';
import { Icon } from './Icon';
import { RankBadge } from './RankBadge';
import { Spinner } from './Spinner';

export function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'individuals' | 'teams'>('individuals');
  const [data, setData] = useState<LeaderboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(null); setData(null);
    void getLeaderboard(controller.signal).then(result => { if (!controller.signal.aborted) setData(result); }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Không tải được bảng xếp hạng.');
    });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="set-overlay leaderboard-overlay" onClick={onClose}>
    <div className="set-panel leaderboard-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="leaderboard-title" onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0]!, last = buttons[buttons.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }}>
      <header className="set-head"><div><small>ZION // TOP 50</small><h2 id="leaderboard-title"><Icon name="lucide:trophy" /> Bảng xếp hạng</h2></div><button className="btn" aria-label="Đóng bảng xếp hạng" onClick={onClose}><Icon name="lucide:x" /></button></header>
      <div className="set-tabs" aria-label="Loại bảng xếp hạng">
        <button aria-pressed={tab === 'individuals'} onClick={() => setTab('individuals')}>Cá nhân</button>
        <button aria-pressed={tab === 'teams'} onClick={() => setTab('teams')}>Đội nhóm</button>
      </div>
      <p className="leaderboard-note">{tab === 'individuals' ? 'Xếp theo điểm tiến trình tích lũy của từng người chơi. Hoàn thành nhiệm vụ để thăng hạng; tử vong làm giảm điểm.' : 'Xếp theo tổng điểm tiến trình của các thành viên hiện tại trong đội, tại thế giới này.'}</p>
      <div className="leaderboard-content" aria-live="polite" aria-busy={!data && !error}>
        {error ? <div className="shop-empty"><p role="alert">{error}</p><button className="btn" onClick={() => setAttempt(n => n + 1)}>Thử lại</button></div> : !data ? <Spinner /> : !data[tab].length ? <p className="shop-empty">{tab === 'teams' ? 'Chưa có đội nhóm nào.' : 'Chưa có người chơi được xếp hạng.'}</p> : <table className="leaderboard-table">
          <caption className="leaderboard-note">{tab === 'individuals' ? 'Top 50 người chơi' : 'Top 50 đội nhóm'}</caption>
          <thead><tr><th scope="col">Hạng</th><th scope="col">{tab === 'individuals' ? 'Người chơi' : 'Đội nhóm'}</th><th scope="col">{tab === 'individuals' ? 'Quân hàm' : 'Thành viên'}</th></tr></thead>
          <tbody>{tab === 'individuals' ? data.individuals.map(r => <tr key={r.position} data-top={r.position <= 3}><td>#{r.position}</td><th scope="row">{r.name}</th><td><RankBadge rank={r.rank} /> {r.rank.title}</td></tr>) : data.teams.map(r => <tr key={r.position} data-top={r.position <= 3}><td>#{r.position}</td><th scope="row">{r.name}</th><td>{r.members}/5</td></tr>)}</tbody>
        </table>}
      </div>
      <footer className="leaderboard-footer"><small>Dữ liệu cập nhật mỗi lần mở bảng.</small><button className="btn" onClick={() => setAttempt(n => n + 1)} disabled={!data && !error}>Làm mới</button></footer>
    </div>
  </div>;
}

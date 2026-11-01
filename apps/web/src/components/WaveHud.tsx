'use client';
import { useEffect, useState } from 'react';
import { WAVE_BOARDS, type WaveStateMessage } from '@zion/shared';
import { Icon } from './Icon';

const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Counts a server countdown down locally between the once-a-second updates. */
function useCountdown(state: WaveStateMessage): number {
  const [now, setNow] = useState(() => performance.now());
  const [base] = useState(() => ({ at: performance.now() }));
  useEffect(() => { base.at = performance.now(); }, [state, base]);
  useEffect(() => { const id = window.setInterval(() => setNow(performance.now()), 250); return () => window.clearInterval(id); }, []);
  return Math.max(0, state.msLeft - (now - base.at));
}

/**
 * Wave survival HUD: the wave and what is left of it (or the break / countdown), the team with
 * who is standing and their kills, and the results card once the team is down.
 */
export function WaveHud({ state, selfId, dead, onLeave }: { state: WaveStateMessage; selfId: number | null; dead: boolean; onLeave(): void }) {
  const left = useCountdown(state);
  const line = state.phase === 'lobby' ? <><Icon name="lucide:users" /> …</>
    : state.phase === 'countdown' ? <><Icon name="lucide:timer" /> {Math.ceil(left / 1000)}s</>
      : state.phase === 'break' ? <><kbd>B</kbd> <Icon name="lucide:shopping-cart" /> · <Icon name="lucide:timer" /> {Math.ceil(left / 1000)}s</>
        : state.phase === 'fighting' ? <span title="Xác sống còn lại"><Icon name="game-icons:shambling-zombie" /> {state.remaining}</span> : <><Icon name="lucide:skull" /> Cả đội đã gục</>;
  return (
    <>
      <div className={`wave-hud phase-${state.phase}`} role="status" aria-live="polite">
        <small>{state.map.name} · <Icon name={state.playMode === 'bots' ? 'lucide:bot' : 'lucide:users'} /></small>
        <b>{state.phase === 'break' ? `SẮP TỚI ĐỢT ${state.wave}` : state.phase === 'over' ? `ĐÃ QUA ${state.cleared} ĐỢT` : `ĐỢT ${state.wave}`}</b>
        <span>{line}</span>
        {state.phase === 'fighting' && <i className="wave-hud-bar" aria-hidden><em style={{ width: `${Math.min(100, state.alive / Math.max(1, state.remaining) * 100)}%` }} /></i>}
      </div>
      <ul className="wave-team" aria-label="Đội hình">
        {state.members.map((m) => (
          <li key={m.id} className={`${m.alive ? '' : 'down'}${m.id === selfId ? ' self' : ''}`}>
            <Icon name={m.bot ? 'lucide:bot' : 'lucide:user'} />
            <span>{m.name}</span>
            {m.bot && <i>BOT</i>}
            <em title="Hạ gục"><Icon name="game-icons:skull-crossed-bones" />{m.kills}</em>
          </li>
        ))}
      </ul>
      {dead && state.phase !== 'over' && <div className="hud-spectate" role="status"><span><Icon name="lucide:skull" /> Bạn đã gục</span><button className="btn" onClick={onLeave}>Về sảnh</button></div>}
      {state.phase === 'over' && <WaveResults state={state} selfId={selfId} onLeave={onLeave} />}
    </>
  );
}

function WaveResults({ state, selfId, onLeave }: { state: WaveStateMessage; selfId: number | null; onLeave(): void }) {
  const result = state.result;
  const board = result?.board ? WAVE_BOARDS.find((b) => b.id === result.board) : null;
  const kills = state.members.reduce((n, m) => n + m.kills, 0);
  const again = () => {
    // The same map and team set-up: a fresh room (a party goes back through its leader's lobby).
    const q = new URLSearchParams(window.location.search);
    if (q.get('party') === '1') { onLeave(); return; }
    q.set('again', String(Date.now()));
    window.location.search = q.toString();
  };
  return (
    <div className="br-results wave-results" role="dialog" aria-label="Kết quả sinh tồn">
      <div className="br-results-card">
        <header className="br-results-head">
          <div className="br-results-place"><small>ĐỢT</small><b>{result?.cleared ?? state.cleared}</b></div>
          <div className="br-results-title">
            <small>{state.map.name}</small>
            <h2>CẢ ĐỘI ĐÃ GỤC</h2>
            {board && <p><Icon name="lucide:trophy" /> {result?.rank ? `#${result.rank} · ` : ''}{board.name}</p>}
          </div>
        </header>
        <div className="br-results-stats">
          <div title="Đợt vượt qua"><small><Icon name="lucide:waves" /> Đợt</small><b>{result?.cleared ?? state.cleared}</b></div>
          <div title="Thời gian sống sót"><small><Icon name="lucide:timer" /> Thời gian</small><b>{clock(result?.survivedMs ?? 0)}</b></div>
          <div title="Xác sống bị hạ"><small><Icon name="game-icons:skull-crossed-bones" /> Hạ gục</small><b>{kills}</b></div>
          <div><small><Icon name="lucide:trophy" /> Bảng</small><b>{board?.name ?? '—'}</b></div>
        </div>
        <div className="br-results-table" role="table" aria-label="Đội hình">
          <div className="br-row br-row-head" role="row"><span>#</span><span>Thành viên</span><span>Hạ gục</span><span>Trạng thái</span></div>
          <div className="br-rows">
            {[...state.members].sort((a, b) => b.kills - a.kills).map((m, i) => (
              <div key={m.id} role="row" className={`br-row${m.id === selfId ? ' self' : ''}`}>
                <span className="br-place">{i + 1}</span>
                <span className="br-name"><b>{m.name}</b>{m.bot && <i>BOT</i>}{m.id === selfId && <em>BẠN</em>}</span>
                <span className="br-kills">{m.kills}</span>
                <span className="br-state">{m.alive ? 'Còn đứng' : 'Đã gục'}</span>
              </div>
            ))}
          </div>
        </div>
        <footer className="br-results-actions">
          <button className="btn" onClick={onLeave}>Về sảnh</button>
          <button className="btn btn-primary" onClick={again}><Icon name="lucide:rotate-ccw" /> Chơi lại</button>
        </footer>
      </div>
    </div>
  );
}

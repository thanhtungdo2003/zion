'use client';
import { useEffect, useState } from 'react';
import type { InfectionState } from '@zion/shared';
import { Icon } from './Icon';

const clock = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/**
 * Infection scoreboard: humans against zombies with the round clock between them, the countdown
 * before the outbreak, the red veil while you are a zombie and the result at the end.
 */
export function InfectionHud({ state, health, onLeave, sniffUntil = 0, sniffReadyAt = 0 }: { state: InfectionState; health: number; onLeave: () => void; sniffUntil?: number; sniffReadyAt?: number }) {
  // The server reports every second; count down smoothly in between.
  const [at, setAt] = useState(() => performance.now());
  const [now, setNow] = useState(at);
  useEffect(() => { setAt(performance.now()); }, [state]);
  useEffect(() => { const id = setInterval(() => setNow(performance.now()), 200); return () => clearInterval(id); }, []);
  const left = Math.max(0, state.remainingMs - (now - at));
  const respawn = state.respawnMs !== undefined ? Math.max(0, state.respawnMs - (now - at)) : null;
  const total = state.humans + state.zombies || 1;
  return (
    <>
      {state.infected && <div className="ifx-veil" aria-hidden="true" />}
      {state.infected && (
        <div className={`ifx-skill${now < sniffUntil ? ' on' : now < sniffReadyAt ? ' wait' : ''}`} role="status" aria-label="Kỹ năng đánh hơi">
          <kbd>Q</kbd><b>Đánh hơi</b>
          <small>{now < sniffUntil ? `${Math.ceil((sniffUntil - now) / 1000)} s` : now < sniffReadyAt ? <><Icon name="lucide:timer" /> {Math.ceil((sniffReadyAt - now) / 1000)} s</> : <><Icon name="lucide:check" /> 10 m</>}</small>
        </div>
      )}
      <div className={`ifx-score${state.infected ? ' zombie' : ''}`} role="status" aria-label={`${state.humans} người, ${state.zombies} zombie`}>
        <div className="ifx-side human"><Icon name="lucide:users" /><b>{state.humans}</b></div>
        <div className="ifx-clock">
          <small>{state.map}{state.round ? ` · ${state.round}/${state.rounds}` : ''}</small>
          <b>{state.phase === 'waiting' ? '—' : clock(left)}</b>
          <i className="ifx-split"><span style={{ width: `${state.humans / total * 100}%` }} /></i>
        </div>
        <div className="ifx-side zombie"><b>{state.zombies}</b><Icon name="game-icons:shambling-zombie" /></div>
      </div>
      {state.phase === 'waiting' && (
        <div className="ifx-banner" role="status">
          <Icon name="lucide:users" />
          <span>Đang ghép trận</span>
          <b>{state.players}/{Math.max(2, state.rules.minPlayers)}</b>
        </div>
      )}
      {state.phase === 'countdown' && (
        <div className="ifx-banner" role="status">
          <Icon name="game-icons:biohazard" />
          <span>Bùng phát sau</span>
          <b>{Math.ceil(left / 1000)}</b>
          <small><kbd>E</kbd> chọn vũ khí</small>
        </div>
      )}
      {state.phase === 'running' && state.infected && respawn === null && health > 0 && (
        <div className="ifx-tag" role="status" title="Một nhát rìu là lây nhiễm"><Icon name="game-icons:shambling-zombie" /> Bạn là zombie</div>
      )}
      {respawn !== null && (
        <div className="ifx-banner dead" role="status"><Icon name="lucide:skull" /><span>Trỗi dậy sau</span><b>{Math.ceil(respawn / 1000)}</b></div>
      )}
      {state.phase === 'finished' && state.winner && (
        <div className={`ifx-result ${state.winner}`} role="status">
          <Icon name={state.winner === 'humans' ? 'lucide:shield' : 'game-icons:shambling-zombie'} />
          <h2>{state.winner === 'humans' ? 'Con người chiến thắng' : 'Zombie chiến thắng'}</h2>
          <p>{state.over ? 'Hết trận' : <>Vòng {state.round + 1}/{state.rounds} · <Icon name="lucide:timer" /> {Math.ceil(left / 1000)}s</>}</p>
          <button className="btn" onClick={onLeave}>Về sảnh</button>
        </div>
      )}
    </>
  );
}

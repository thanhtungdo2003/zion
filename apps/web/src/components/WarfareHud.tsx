'use client';
import { useEffect, useState } from 'react';
import { type ClientMessage, type WarfareOrderKind, type WarfareSide, type WarfareStateMessage } from '@zion/shared';
import { Icon } from './Icon';
import { WarfareLoadout } from './WarfareLoadout';

type WarfareMsg = ClientMessage & { t: 'wfDeploy' | 'wfSquad' | 'wfOrder' | 'wfRecruit' | 'wfEmote' };
const SIDE: Record<WarfareSide, { name: string; short: string; color: string }> = {
  blue: { name: 'Phe Xanh · Tấn công', short: 'XANH', color: '#4fa3ff' },
  red: { name: 'Phe Đỏ · Phòng thủ', short: 'ĐỎ', color: '#ff5a4a' },
};
const ORDERS: Record<WarfareOrderKind, string> = { follow: 'Đi theo', hold: 'Giữ vị trí', move: 'Di chuyển', attack: 'Tấn công', defend: 'Phòng thủ', regroup: 'Tập hợp' };
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Counts the server's countdowns down locally between the once-a-second updates. */
function useElapsed(state: WarfareStateMessage): number {
  const [now, setNow] = useState(() => performance.now());
  const [base] = useState(() => ({ at: performance.now() }));
  useEffect(() => { base.at = performance.now(); }, [state, base]);
  useEffect(() => { const id = window.setInterval(() => setNow(performance.now()), 250); return () => window.clearInterval(id); }, []);
  return now - base.at;
}

/**
 * Warfare HUD: both sides' tickets and the zones along the top, your squad and bot followers with
 * their orders; the loadout screen (class, weapons, attachments, deploy point) while you
 * are off the field; the result card at the end.
 */
export function WarfareHud({ state, selfId, dead, scoreboard, onSend, onModal, onLeave }: { state: WarfareStateMessage; selfId: number | null; dead: boolean; scoreboard: boolean; onSend: (m: WarfareMsg) => void; onModal: (open: boolean) => void; onLeave: () => void }) {
  const elapsed = useElapsed(state);
  const you = state.you;
  const deploying = !!you && dead && state.phase !== 'over';
  useEffect(() => { onModal(deploying); if (deploying) document.exitPointerLock?.(); }, [deploying, onModal]);
  if (!you) return null;
  const left = Math.max(0, state.msLeft - elapsed);
  const enemy: WarfareSide = you.side === 'blue' ? 'red' : 'blue';
  return (
    <>
      <div className="wf-top" role="status" aria-live="polite">
        <Tickets side={you.side} state={state} />
        <div className="wf-mid">
          <b>{state.phase === 'lobby' ? '—' : state.phase === 'countdown' ? Math.ceil(left / 1000) : state.phase === 'over' ? '■' : state.msLeft ? clock(left) : '∞'}</b>
          <ul className="wf-zones" aria-label="Cứ điểm">
            {state.zones.map((z) => (
              <li key={z.id} className={`${z.owner ?? 'neutral'}${z.contested ? ' contested' : ''}`} title={z.name}>
                <span>{z.name.slice(0, 1)}</span>
                <i style={{ width: `${Math.abs(z.progress) * 100}%`, background: z.progress > 0 ? SIDE.blue.color : SIDE.red.color }} />
              </li>
            ))}
          </ul>
        </div>
        <Tickets side={enemy} state={state} />
      </div>
      {!deploying && state.phase !== 'over' && <SquadPanel state={state} onSend={onSend} />}
      {deploying && <WarfareLoadout state={state} elapsed={elapsed} onSend={onSend} onLeave={onLeave} squads={<SquadJoin state={state} onSend={onSend} />} />}
      {(state.phase === 'over' || (scoreboard && !deploying)) && <Results state={state} selfId={selfId} onLeave={onLeave} final={state.phase === 'over'} />}
    </>
  );
}

function Tickets({ side, state }: { side: WarfareSide; state: WarfareStateMessage }) {
  const t = state.tickets[side], bleed = state.bleed[side];
  return (
    <div className={`wf-tickets ${side}${bleed > 0 ? ' bleeding' : ''}`} title={SIDE[side].name}>
      <b>{t}</b>
      <i><em style={{ width: `${Math.max(0, t / Math.max(1, state.startTickets)) * 100}%`, background: SIDE[side].color }} /></i>
    </div>
  );
}

/** Your bot followers: a count and the three orders (icons; no text on screen). */
function SquadPanel({ state, onSend }: { state: WarfareStateMessage; onSend: (m: WarfareMsg) => void }) {
  const you = state.you!;
  if (!you.followers.length) return null;
  const alive = you.followers.filter((id) => state.units.some((u) => u.id === id && u.alive)).length;
  const order = (kind: WarfareOrderKind) => onSend({ t: 'wfOrder', order: { kind } });
  return (
    <aside className="wf-squad" aria-label="Bot theo bạn">
      <span className="wf-squad-count" title="Bot theo bạn"><Icon name="lucide:bot" /><b>{alive}</b>/{you.followers.length}</span>
      {ORDER_ICONS.map(([k, icon]) => <button key={k} type="button" className={you.order === k ? 'on' : ''} title={ORDERS[k]} aria-label={ORDERS[k]} onClick={() => order(k)}><Icon name={icon} /></button>)}
    </aside>
  );
}
const ORDER_ICONS = [['follow', 'lucide:footprints'], ['hold', 'lucide:hand'], ['regroup', 'lucide:users']] as const;

/** Player squads: make or leave one, or join another (by number). */
function SquadJoin({ state, onSend }: { state: WarfareStateMessage; onSend: (m: WarfareMsg) => void }) {
  const you = state.you!, names = new Map(state.units.map((u) => [u.id, u.name]));
  return (
    <div className="wfl-squads" aria-label="Đội">
      {you.squad !== null
        ? <button type="button" className="on" title="Rời đội" onClick={() => onSend({ t: 'wfSquad', action: 'leave' })}><Icon name="lucide:users" />#{you.squad}<Icon name="lucide:x" /></button>
        : <button type="button" title="Lập đội" onClick={() => onSend({ t: 'wfSquad', action: 'create' })}><Icon name="lucide:user-plus" /></button>}
      {state.squads.filter((sq) => sq.id !== you.squad).map((sq) => (
        <button key={sq.id} type="button" title={sq.members.map((m) => names.get(m) ?? '?').join(', ')} onClick={() => onSend({ t: 'wfSquad', action: 'join', id: sq.id })}><Icon name="lucide:users" />#{sq.id}<small>{sq.members.length}</small></button>
      ))}
    </div>
  );
}

function Results({ state, selfId, onLeave, final }: { state: WarfareStateMessage; selfId: number | null; onLeave: () => void; final: boolean }) {
  const r = state.result, you = state.you!;
  const won = r?.winner === you.side;
  const rows = [...state.units].sort((a, b) => (a.side === b.side ? b.kills - a.kills : a.side === you.side ? -1 : 1));
  return (
    <div className={`br-results wf-results${won ? ' won' : ''}${final ? '' : ' peek'}`} role="dialog" aria-label="Kết quả">
      <div className="br-results-card">
        <header className="br-results-head">
          <div className="br-results-place"><small>{final ? (won ? 'THẮNG' : 'THUA') : clock(state.msLeft)}</small><b>{state.tickets.blue}:{state.tickets.red}</b><span>{SIDE[you.side].short}</span></div>
          {final && r && <div className="br-results-title"><h2>{SIDE[r.winner].short} thắng</h2></div>}
        </header>
        <div className="br-results-table" role="table" aria-label="Bảng điểm">
          <div className="br-row br-row-head wf-row" role="row"><span /><span /><span>K</span><span>A</span><span>D</span><span>C</span></div>
          <div className="br-rows">
            {rows.map((u) => (
              <div key={u.id} role="row" className={`br-row wf-row${u.id === selfId ? ' self' : ''}`}>
                <span><i className="wf-side" style={{ background: SIDE[u.side].color }} /></span>
                <span className="br-name"><b>{u.name}</b>{u.bot && <i>BOT</i>}{u.id === selfId && <em>BẠN</em>}</span>
                <span>{u.kills}</span><span>{u.assists}</span><span>{u.deaths}</span><span>{u.captures}</span>
              </div>
            ))}
          </div>
        </div>
        {final && <footer className="br-results-actions">
          <button className="btn" onClick={onLeave}>Về sảnh</button>
          <button className="btn btn-primary" onClick={() => { const q = new URLSearchParams(window.location.search); q.set('again', String(Date.now())); window.location.search = q.toString(); }}><Icon name="lucide:rotate-ccw" /> Trận mới</button>
        </footer>}
      </div>
    </div>
  );
}

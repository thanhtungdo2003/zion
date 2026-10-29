'use client';
import { useEffect, useMemo, useState } from 'react';
import { ITEMS, WARFARE_CLASSES, WARFARE_KITS, sanitizeWarfareLoadout, type ClientMessage, type WarfareClass, type WarfareLoadout, type WarfareOrderKind, type WarfareSide, type WarfareStateMessage } from '@zion/shared';
import { Icon } from './Icon';

type WarfareMsg = ClientMessage & { t: 'wfDeploy' | 'wfSquad' | 'wfOrder' | 'wfRecruit' | 'wfEmote' };
const SIDE: Record<WarfareSide, { name: string; short: string; color: string }> = {
  blue: { name: 'Phe Xanh · Tấn công', short: 'XANH', color: '#4fa3ff' },
  red: { name: 'Phe Đỏ · Phòng thủ', short: 'ĐỎ', color: '#ff5a4a' },
};
const ORDERS: Record<WarfareOrderKind, string> = { follow: 'Đi theo', hold: 'Giữ vị trí', move: 'Di chuyển', attack: 'Tấn công', defend: 'Phòng thủ', regroup: 'Tập hợp' };
const TASKS = { attack: 'tấn công', defend: 'phòng thủ', reinforce: 'tiếp viện', scout: 'trinh sát' } as const;
const LOADOUT_KEY = 'zion.warfare.loadout';
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const itemName = (id: string | null) => (id ? ITEMS[id]?.name ?? id : 'Không mang');

/** Counts the server's countdowns down locally between the once-a-second updates. */
function useElapsed(state: WarfareStateMessage): number {
  const [now, setNow] = useState(() => performance.now());
  const [base] = useState(() => ({ at: performance.now() }));
  useEffect(() => { base.at = performance.now(); }, [state, base]);
  useEffect(() => { const id = window.setInterval(() => setNow(performance.now()), 250); return () => window.clearInterval(id); }, []);
  return now - base.at;
}

interface Saved { cls: WarfareClass; loadout: Record<WarfareClass, WarfareLoadout> }
function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? 'null') as Saved | null;
    if (v && WARFARE_CLASSES.includes(v.cls)) return { cls: v.cls, loadout: { ...v.loadout } };
  } catch { /* storage blocked */ }
  return { cls: 'assault', loadout: {} as Record<WarfareClass, WarfareLoadout> };
}

/**
 * Warfare HUD: both sides' tickets and the zones along the top, your squad and bot followers with
 * their orders, a small tactical map; the deploy screen (class, weapons, deploy point) while you
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
          <small>{state.map.name} · {state.active}/{state.maxActive} trên chiến trường</small>
          <b>{state.phase === 'lobby' ? 'ĐANG CHỜ' : state.phase === 'countdown' ? `BẮT ĐẦU SAU ${Math.ceil(left / 1000)}` : state.phase === 'over' ? 'KẾT THÚC' : state.msLeft ? clock(left) : '∞'}</b>
          <ul className="wf-zones" aria-label="Cứ điểm">
            {state.zones.map((z) => (
              <li key={z.id} className={`${z.owner ?? 'neutral'}${z.contested ? ' contested' : ''}`} title={`${z.name}${z.contested ? ' · đang tranh chấp' : ''} · Xanh ${z.presence.blue} / Đỏ ${z.presence.red}`}>
                <span>{z.name.slice(0, 1)}</span>
                <i style={{ width: `${Math.abs(z.progress) * 100}%`, background: z.progress > 0 ? SIDE.blue.color : SIDE.red.color }} />
              </li>
            ))}
          </ul>
        </div>
        <Tickets side={enemy} state={state} />
      </div>
      {!deploying && state.phase !== 'over' && <SquadPanel state={state} selfId={selfId} onSend={onSend} />}
      {!deploying && state.phase !== 'over' && <TacticalMap state={state} selfId={selfId} small />}
      {deploying && <DeployScreen state={state} selfId={selfId} elapsed={elapsed} onSend={onSend} onLeave={onLeave} />}
      {(state.phase === 'over' || (scoreboard && !deploying)) && <Results state={state} selfId={selfId} onLeave={onLeave} final={state.phase === 'over'} />}
    </>
  );
}

function Tickets({ side, state }: { side: WarfareSide; state: WarfareStateMessage }) {
  const t = state.tickets[side], bleed = state.bleed[side];
  return (
    <div className={`wf-tickets ${side}`} title={`${SIDE[side].name}: ${t} quân số dự bị${bleed ? ` · đang mất ${bleed.toFixed(1)}/giây` : ''}`}>
      <small>{SIDE[side].short}{side === state.you?.side ? ' · BẠN' : ''}</small>
      <b>{t}</b>
      <i><em style={{ width: `${Math.max(0, t / Math.max(1, state.startTickets)) * 100}%`, background: SIDE[side].color }} /></i>
      {bleed > 0 && <span className="wf-bleed"><Icon name="lucide:trending-down" /> −{bleed.toFixed(1)}/s</span>}
    </div>
  );
}

function SquadPanel({ state, selfId, onSend }: { state: WarfareStateMessage; selfId: number | null; onSend: (m: WarfareMsg) => void }) {
  const you = state.you!;
  const byId = new Map(state.units.map((u) => [u.id, u]));
  const squad = you.squad !== null ? state.squads.find((s) => s.id === you.squad) : undefined;
  const self = selfId !== null ? byId.get(selfId) : undefined;
  const dist = (id: number) => { const u = byId.get(id); return self?.x !== undefined && u?.x !== undefined && u.z !== undefined && self.z !== undefined ? `${Math.round(Math.hypot(u.x - self.x, u.z - self.z))} m` : ''; };
  const order = (kind: WarfareOrderKind) => onSend({ t: 'wfOrder', order: { kind } });
  return (
    <aside className="wf-squad" aria-label="Đội của bạn">
      {squad && <>
        <h3>Đội #{squad.id}</h3>
        <ul>{squad.members.map((id, i) => { const u = byId.get(id); return <li key={id} className={u?.alive ? '' : 'down'}><Icon name={i === 0 ? 'lucide:star' : 'lucide:user'} /><span>{u?.name ?? '?'}</span><em>{id === selfId ? 'bạn' : u?.alive ? dist(id) : 'đã hạ'}</em></li>; })}</ul>
      </>}
      <h3>Bot theo bạn · {you.followers.length}{you.order ? ` · ${ORDERS[you.order]}` : ''}</h3>
      {you.followers.length ? <ul>{you.followers.map((id) => { const u = byId.get(id); return <li key={id} className={u?.alive ? '' : 'down'}><Icon name="lucide:bot" /><span>{u?.name ?? '?'}</span><em>{u?.alive ? dist(id) : 'đang chờ'}</em></li>; })}</ul>
        : <p className="wf-hint">Nhắm vào bot đồng minh và nhấn <kbd>G</kbd> để tuyển (hoặc <kbd>G</kbd> để gọi bot gần nhất).</p>}
      {you.followers.length > 0 && <div className="wf-orders">
        {(['follow', 'hold', 'regroup'] as const).map((k) => <button key={k} type="button" className={`btn${you.order === k ? ' on' : ''}`} onClick={() => order(k)}>{ORDERS[k]}</button>)}
      </div>}
      <p className="wf-keys"><kbd>G</kbd> tuyển / chỉ điểm · <kbd>Z</kbd> vẫy gọi · <kbd>Y</kbd> dừng lại · <kbd>Shift</kbd>+<kbd>G</kbd> giải tán</p>
    </aside>
  );
}

/** The battlefield from above: zones by owner, bases, allies, your followers, deploy points. */
function TacticalMap({ state, selfId, small, pick, onPick, onZone }: { state: WarfareStateMessage; selfId: number | null; small?: boolean; pick?: string | null; onPick?: (id: string) => void; onZone?: (id: string) => void }) {
  const box = useMemo(() => {
    const xs = [state.bases.blue.x, state.bases.red.x, ...state.zones.flatMap((z) => [z.x - z.radius, z.x + z.radius])];
    const zs = [state.bases.blue.z, state.bases.red.z, ...state.zones.flatMap((z) => [z.z - z.radius, z.z + z.radius])];
    const pad = 16, x0 = Math.min(...xs) - pad, z0 = Math.min(...zs) - pad, size = Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0) + pad;
    return { x0, z0, size };
  }, [state.bases, state.zones]);
  const you = state.you!;
  const followers = new Set(you.followers);
  return (
    <svg className={`wf-map${small ? ' small' : ''}`} viewBox={`${box.x0} ${box.z0} ${box.size} ${box.size}`} role="img" aria-label="Bản đồ chiến thuật">
      <rect x={box.x0} y={box.z0} width={box.size} height={box.size} fill="rgba(10,12,12,.78)" />
      {(['blue', 'red'] as const).map((s) => <g key={s}><rect x={state.bases[s].x - 5} y={state.bases[s].z - 5} width={10} height={10} fill={SIDE[s].color} opacity={.8} /><text x={state.bases[s].x} y={state.bases[s].z - 8} textAnchor="middle" fontSize={7} fill="#ddd">CĂN CỨ</text></g>)}
      {state.zones.map((z) => (
        <g key={z.id} className={onZone ? 'click' : undefined} onClick={onZone ? () => onZone(z.id) : undefined}>
          <circle cx={z.x} cy={z.z} r={z.radius} fill={z.owner ? SIDE[z.owner].color : '#999'} fillOpacity={.22} stroke={z.contested ? '#ffb000' : z.owner ? SIDE[z.owner].color : '#bbb'} strokeWidth={z.contested ? 2 : 1} strokeDasharray={z.contested ? '3 2' : undefined} />
          <text x={z.x} y={z.z + 3} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff">{z.name.slice(0, 1)}</text>
        </g>
      ))}
      {state.tasks.map((t) => { const z = state.zones.find((zz) => zz.id === t.zone); return z ? <text key={t.squad} x={z.x} y={z.z + z.radius + 8} textAnchor="middle" fontSize={5} fill="#ccc">{TASKS[t.kind]}</text> : null; })}
      {state.units.filter((u) => u.alive && u.x !== undefined && u.z !== undefined).map((u) => (
        <circle key={u.id} cx={u.x} cy={u.z} r={u.id === selfId ? 3 : followers.has(u.id) ? 2.2 : 1.6} fill={u.id === selfId ? '#ffb000' : followers.has(u.id) ? '#9fe870' : SIDE[u.side].color} stroke="#000" strokeWidth={.5} />
      ))}
      {onPick && state.deploy.map((d) => (
        <g key={d.id} className={d.safe ? 'click' : 'unsafe'} onClick={d.safe ? () => onPick(d.id) : undefined}>
          <circle cx={d.x} cy={d.z} r={6} fill={pick === d.id ? '#ffb000' : d.safe ? 'rgba(255,255,255,.15)' : 'rgba(255,60,48,.2)'} stroke={pick === d.id ? '#fff' : d.safe ? '#ffb000' : '#ff3b30'} strokeWidth={1.2} />
          <text x={d.x} y={d.z + 12} textAnchor="middle" fontSize={6} fill={d.safe ? '#fff' : '#ff8a80'}>{d.name}</text>
        </g>
      ))}
    </svg>
  );
}

function DeployScreen({ state, selfId, elapsed, onSend, onLeave }: { state: WarfareStateMessage; selfId: number | null; elapsed: number; onSend: (m: WarfareMsg) => void; onLeave: () => void }) {
  const you = state.you!;
  const [saved, setSaved] = useState<Saved>(() => loadSaved());
  const [spawn, setSpawn] = useState<string | null>(you.spawn);
  const cls = saved.cls, kit = WARFARE_KITS[cls];
  const choice = sanitizeWarfareLoadout(cls, saved.loadout[cls]);
  const save = (next: Saved) => { setSaved(next); try { localStorage.setItem(LOADOUT_KEY, JSON.stringify(next)); } catch { /* storage blocked */ } };
  const set = (patch: WarfareLoadout) => save({ ...saved, loadout: { ...saved.loadout, [cls]: { ...choice, ...patch } } });
  const wait = Math.max(0, (you.respawnIn ?? 0) - elapsed);
  const chosen = state.deploy.find((d) => d.id === spawn);
  // A point that is no longer ours or no longer safe falls back to automatic.
  useEffect(() => { if (spawn && !state.deploy.some((d) => d.id === spawn && d.safe)) setSpawn(null); }, [state.deploy, spawn]);
  const deploy = (ready: boolean) => onSend({ t: 'wfDeploy', cls, loadout: choice, ...(spawn ? { spawn } : {}), ready });
  const toggleGadget = (g: string) => set({ gadgets: choice.gadgets.includes(g) ? choice.gadgets.filter((x) => x !== g) : [...choice.gadgets, g].slice(-kit.maxGadgets) });
  return (
    <div className="wf-deploy" role="dialog" aria-label="Triển khai">
      <div className="wf-deploy-card">
        <header>
          <div><small>{SIDE[you.side].name}</small><h2>TRIỂN KHAI</h2></div>
          <div className="wf-deploy-status">
            {you.waiting ? <span className="warn">{you.waiting}</span> : wait > 0 ? <span>Có thể triển khai sau <b>{Math.ceil(wait / 1000)}</b> giây</span> : <span>Sẵn sàng triển khai</span>}
            <small>Quân số dự bị: {state.tickets[you.side]} · {state.active}/{state.maxActive} trên chiến trường · {state.queued} đang chờ</small>
          </div>
        </header>
        <div className="wf-deploy-body">
          <section className="wf-classes" aria-label="Binh chủng">
            {WARFARE_CLASSES.map((c) => (
              <button key={c} type="button" className={`wf-class${c === cls ? ' on' : ''}`} onClick={() => save({ ...saved, cls: c })}>
                <b>{WARFARE_KITS[c].name}</b><small>{WARFARE_KITS[c].role}</small>
              </button>
            ))}
          </section>
          <section className="wf-loadout" aria-label="Trang bị">
            <Pick label="Vũ khí chính" value={choice.primary} options={kit.primary} onChange={(v) => set({ primary: v! })} />
            {kit.heavy.length > 0 && <Pick label="Vũ khí hạng nặng" value={choice.heavy} options={kit.heavy} allowNone onChange={(v) => set({ heavy: v })} />}
            {choice.secondary !== null || kit.secondary.length ? <Pick label="Vũ khí phụ" value={choice.secondary} options={ITEMS[choice.primary]?.category === 'smg' ? [] : kit.secondary} allowNone onChange={(v) => set({ secondary: v })} /> : null}
            <div className="wf-pick"><small>Vật phẩm chiến thuật (tối đa {kit.maxGadgets})</small>
              <div className="wf-chips">{kit.gadgets.map((g) => <button key={g} type="button" className={`btn${choice.gadgets.includes(g) ? ' on' : ''}`} onClick={() => toggleGadget(g)}>{itemName(g)}</button>)}</div>
            </div>
            <p className="wf-gear">Bảo hộ: {itemName(kit.head)}, {itemName(kit.chest)}{kit.ears ? `, ${itemName(kit.ears)}` : ''} · {kit.medkits} {itemName('medkit')} · đạn dự phòng theo súng</p>
          </section>
          <section className="wf-spawn" aria-label="Điểm triển khai">
            <TacticalMap state={state} selfId={selfId} pick={spawn} onPick={(id) => setSpawn(id === spawn ? null : id)} />
            <p>{chosen ? <>Triển khai tại <b>{chosen.name}</b></> : 'Tự chọn điểm an toàn gần mặt trận'} · bấm điểm trên bản đồ để chọn</p>
            <SquadJoin state={state} onSend={onSend} />
          </section>
        </div>
        <footer>
          <button className="btn" type="button" onClick={onLeave}>Rời trận</button>
          {you.ready
            ? <button className="btn" type="button" onClick={() => deploy(false)}>Huỷ · đổi trang bị</button>
            : <button className="btn btn-primary" type="button" onClick={() => deploy(true)}><Icon name="lucide:parachute" /> TRIỂN KHAI</button>}
        </footer>
      </div>
    </div>
  );
}

function Pick({ label, value, options, allowNone, onChange }: { label: string; value: string | null; options: readonly string[]; allowNone?: boolean; onChange: (v: string | null) => void }) {
  return (
    <label className="wf-pick"><small>{label}</small>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {allowNone && <option value="">Không mang</option>}
        {options.map((o) => <option key={o} value={o}>{itemName(o)}</option>)}
      </select>
    </label>
  );
}

function SquadJoin({ state, onSend }: { state: WarfareStateMessage; onSend: (m: WarfareMsg) => void }) {
  const you = state.you!, names = new Map(state.units.map((u) => [u.id, u.name]));
  return (
    <div className="wf-squads">
      <small>Đội người chơi</small>
      {you.squad !== null
        ? <button className="btn" type="button" onClick={() => onSend({ t: 'wfSquad', action: 'leave' })}>Rời đội #{you.squad}</button>
        : <button className="btn" type="button" onClick={() => onSend({ t: 'wfSquad', action: 'create' })}>Lập đội mới</button>}
      {state.squads.filter((s) => s.id !== you.squad).map((s) => (
        <button key={s.id} className="btn" type="button" onClick={() => onSend({ t: 'wfSquad', action: 'join', id: s.id })}>Vào đội #{s.id} · {s.members.map((m) => names.get(m) ?? '?').join(', ')}</button>
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
          <div className="br-results-place"><small>{final ? 'KẾT QUẢ' : 'TỈ SỐ'}</small><b>{final ? (won ? 'THẮNG' : 'THUA') : `${state.tickets.blue}:${state.tickets.red}`}</b><span>{SIDE[you.side].short}</span></div>
          <div className="br-results-title">
            <small>{state.map.name} · Chiến trường</small>
            <h2>{r ? `${SIDE[r.winner].name} chiến thắng` : 'Trận đang diễn ra'}</h2>
            {r && <p>{r.reason === 'tickets' ? 'Đối phương hết quân số dự bị.' : r.reason === 'time' ? 'Hết giờ — nhiều quân số hơn.' : r.reason === 'objectives' ? 'Giữ toàn bộ cứ điểm.' : 'Đối phương đã rời trận.'}</p>}
          </div>
        </header>
        {r && <div className="br-results-stats">
          <div><small>Quân số đã dùng · Xanh</small><b>{r.ticketsUsed.blue}</b></div>
          <div><small>Quân số đã dùng · Đỏ</small><b>{r.ticketsUsed.red}</b></div>
          <div><small>Cứ điểm chiếm · Xanh</small><b>{r.captures.blue}</b></div>
          <div><small>Cứ điểm chiếm · Đỏ</small><b>{r.captures.red}</b></div>
        </div>}
        <div className="br-results-table" role="table" aria-label="Bảng điểm">
          <div className="br-row br-row-head wf-row" role="row"><span>Phe</span><span>Tên</span><span>Hạ</span><span>Hỗ trợ</span><span>Chết</span><span>Chiếm</span></div>
          <div className="br-rows">
            {rows.map((u) => (
              <div key={u.id} role="row" className={`br-row wf-row${u.id === selfId ? ' self' : ''}`}>
                <span style={{ color: SIDE[u.side].color }}>{SIDE[u.side].short}</span>
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

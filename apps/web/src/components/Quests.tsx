'use client';

import { ITEMS } from '@zion/shared';
import { useEffect, useState } from 'react';
import type { HudState } from '@/game/hud-store';
import { itemIcons } from '@/game/inventory/icons';
import { Coins } from './Inventory';
import { Spinner } from './Spinner';
import { usePending } from '@/game/pending';

type Quest = HudState['quests'][number];
type Op = 'accept' | 'cancel' | 'turnin';
type Trade = NonNullable<HudState['life']>['config']['trades'][number];

function itemName(id: string): string {
  return ITEMS[id]?.name ?? id;
}

function ItemIcon({ id }: { id: string }) {
  const src = itemIcons.get(id);
  return src ? <img className="q-item-icon" src={src} alt="" /> : <span className="q-item-icon" style={{ background: ITEMS[id]?.color ?? '#333' }} />;
}

function Progress({ q }: { q: Quest }) {
  if (q.goal <= 1) return null;
  const done = Math.min(q.progress, q.goal);
  return (
    <div className="q-progress">
      <div style={{ width: `${(done / q.goal) * 100}%` }} />
      <span>{done}/{q.goal}</span>
    </div>
  );
}

function Rewards({ q }: { q: Quest }) {
  if (q.rewards.coins <= 0 && !q.rewards.items.length) return null;
  return (
    <div className="q-rewards">
      <span className="q-label">Phần thưởng</span>
      <div className="q-reward-list">
        {q.rewards.coins > 0 && <Coins n={q.rewards.coins} />}
        {q.rewards.items.map((r) => (
          <span key={r.item} className="q-reward" title={itemName(r.item)}>
            <ItemIcon id={r.item} />
            <b>×{r.count}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Top-left list of accepted quests and their current objective. */
export function QuestTracker({ quests, position, onCancel }: { quests: Quest[]; position: [number, number, number]; onCancel: (q: Quest) => void }) {
  const busy = usePending();
  const open = quests.filter((q) => q.status === 'active' || q.status === 'ready');
  if (!open.length) return null;
  return (
    <div className="q-tracker">
      <div className="q-tracker-head">Nhiệm vụ <span>{open.length}</span></div>
      {open.slice(0, 5).map((q) => {
        // Distance to the nearest quest item when there are some, else to the quest area.
        const spots = q.drops?.length ? q.drops : q.target ? [q.target] : [];
        const dist = spots.length && q.status === 'active' ? Math.round(Math.min(...spots.map((t) => Math.hypot(t.x - position[0], t.z - position[2])))) : null;
        const ready = q.status === 'ready';
        return (
          <div key={q.id} className={`q-track ${ready ? 'ready' : ''}`}>
            <div className="q-track-title">
              <i className={`q-kind ${q.kind}`} />
              <span>{q.title}</span>
              {q.allowCancel && (
                <button className="q-track-cancel" title="Hủy nhiệm vụ" disabled={busy(`quest:${q.id}`)} onClick={() => { if (confirm(`Hủy nhiệm vụ "${q.title}"?`)) onCancel(q); }}>
                  {busy(`quest:${q.id}`) ? <Spinner /> : '✕'}
                </button>
              )}
            </div>
            <div className="q-track-obj">
              {ready ? '✓ Quay lại nhận thưởng' : q.objective}
              {!ready && q.stages > 1 && <em> · {q.stage + 1}/{q.stages}</em>}
              {dist !== null && <em className="q-dist"> ⌖ {dist} m</em>}
            </div>
            {!ready && <Progress q={q} />}
          </div>
        );
      })}
    </div>
  );
}

const STATUS_ORDER: Record<string, number> = { ready: 0, active: 1, available: 2, cancelled: 2, claimed: 3 };

/** Conversation with a quest NPC: a quest list on the left, the selected quest (or trading) on the right. */
export function NpcDialogue({ npc, name, quests, onOp, onClose, trades, owned, coins, onTrade, side }: { side?: React.ReactNode; npc: string; name: string; quests: Quest[]; onOp: (op: Op, quest: string) => void; onClose: () => void; trades: Trade[]; owned: (item: string) => number; coins: number; onTrade: (side: 'buy' | 'sell', id: string) => void }) {
  const list = quests
    .filter((q) => q.npc === npc && (q.status !== 'available' && q.status !== 'cancelled' ? true : !q.locked))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  const [tab, setTab] = useState<'quests' | 'trade'>('quests');
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.find((q) => q.id === selId) ?? list.find((q) => q.status !== 'claimed') ?? null;
  const busy = usePending();
  const qBusy = !!sel && busy(`quest:${sel.id}`);
  const line = !sel ? 'Hiện ta chưa có việc gì cho cậu. Quay lại sau nhé.'
    : sel.status === 'ready' ? sel.dialogue.complete
    : sel.status === 'active' ? sel.dialogue.progress
    : sel.status === 'claimed' ? sel.dialogue.complete : sel.dialogue.offer;

  return (
    <div className="q-overlay">
      <div className="q-wrap">
      {side}
      <div className="q-dialog">
        <header className="q-head">
          <div>
            <span className="q-kicker">Zion // Liên lạc</span>
            <h2>{name}</h2>
          </div>
          <div className="q-tabs">
            <button className={tab === 'quests' ? 'on' : ''} onClick={() => setTab('quests')}>Nhiệm vụ</button>
            {trades.length > 0 && <button className={tab === 'trade' ? 'on' : ''} onClick={() => setTab('trade')}>Mua bán</button>}
          </div>
          <button className="q-close" onClick={onClose} title="Đóng (Esc)">✕</button>
        </header>

        {tab === 'quests' ? (
          <div className="q-body">
            <nav className="q-list">
              {list.length === 0 && <div className="q-empty">Không có nhiệm vụ</div>}
              {list.map((q) => (
                <button key={q.id} className={`q-entry ${q.status} ${sel?.id === q.id ? 'sel' : ''}`} onClick={() => setSelId(q.id)}>
                  <i className={`q-kind ${q.kind}`} />
                  <span>{q.title}</span>
                  {q.status === 'ready' && <b className="q-badge">!</b>}
                  {q.status === 'active' && <small>Đang làm</small>}
                  {q.status === 'claimed' && <small>✓</small>}
                </button>
              ))}
            </nav>
            <section className="q-detail">
              <blockquote className="q-quote">“{line}”</blockquote>
              {sel && (
                <>
                  <div className="q-title-row">
                    <h3>{sel.title}</h3>
                    <span className={`q-tag ${sel.kind}`}>{sel.kind === 'daily' ? 'Hằng ngày' : 'Dài hạn'}</span>
                  </div>
                  <p className="q-desc">{sel.description}</p>
                  {sel.status !== 'claimed' && (
                    <div className="q-objective">
                      <span className="q-label">Mục tiêu{sel.stages > 1 ? ` · bước ${Math.min(sel.stage + 1, sel.stages)}/${sel.stages}` : ''}</span>
                      <div>{sel.status === 'ready' ? 'Đã hoàn thành — nhận thưởng' : sel.objective}</div>
                      {sel.status === 'active' && <Progress q={sel} />}
                    </div>
                  )}
                  <Rewards q={sel} />
                  <div className="q-actions">
                    {(sel.status === 'available' || sel.status === 'cancelled') && <button className="btn btn-primary" data-nosound disabled={qBusy} onClick={() => onOp('accept', sel.id)}>{qBusy ? <Spinner /> : 'Nhận nhiệm vụ'}</button>}
                    {sel.status === 'ready' && <button className="btn btn-primary" data-nosound disabled={qBusy} onClick={() => onOp('turnin', sel.id)}>{qBusy ? <Spinner /> : 'Nhận thưởng'}</button>}
                    {sel.status === 'active' && <button className="btn btn-primary" data-nosound disabled={qBusy} onClick={() => onOp('turnin', sel.id)}>{qBusy ? <Spinner /> : 'Giao đồ'}</button>}
                    {sel.status === 'active' && sel.allowCancel && <button className="btn q-btn-danger" disabled={qBusy} onClick={() => onOp('cancel', sel.id)}>Hủy</button>}
                  </div>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="q-trade">
            <div className="q-trade-head">
              <span className="q-label">Ví</span>
              <Coins n={coins} />
            </div>
            {trades.map((t) => (
              <div key={t.id} className="q-trade-row">
                <ItemIcon id={t.item} />
                <div className="q-trade-name">
                  <b>{itemName(t.item)}</b>
                  <small>Có {owned(t.item)} · tối đa {t.quota} lần / đợt</small>
                </div>
                {t.buy > 0 && <button className="btn btn-primary" disabled={coins < t.buy || busy(`trade:${t.id}:buy`)} data-nosound onClick={() => onTrade('buy', t.id)}>{busy(`trade:${t.id}:buy`) ? <Spinner /> : `Mua ${t.buy}`}</button>}
                {t.sell > 0 && <button className="btn" disabled={owned(t.item) < 1 || busy(`trade:${t.id}:sell`)} onClick={() => onTrade('sell', t.id)}>{busy(`trade:${t.id}:sell`) ? <Spinner /> : `Bán ${t.sell}`}</button>}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/** Timed planting/cooking progress (the stamina bar lives under the health bar). */
export function StaminaBar({ life }: { life: NonNullable<HudState['life']> }) {
  const [now, setNow] = useState(() => Date.now());
  const action = life.action;
  useEffect(() => {
    if (!action) return;
    const t = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(t);
  }, [action]);
  if (!action) return null;
  const total = action.ms || 1;
  const done = Math.max(0, Math.min(1, 1 - (action.end - now) / total));
  return (
    <div className="q-action">
      <span>{action.kind === 'plant' ? 'Đang trồng' : action.kind === 'harvest' ? 'Đang thu hoạch' : 'Đang nấu'}</span> <small>di chuyển để hủy</small>
      <div className="q-action-bar"><div style={{ width: `${done * 100}%` }} /></div>
    </div>
  );
}

/** Standing on an empty garden plot: the seeds we carry; click one to plant it. */
export function PlantPanel({ life, items, onPlant }: { life: NonNullable<HudState['life']>; items: Array<{ itemId: string; count?: number }>; onPlant: (crop: string) => void }) {
  const busy = usePending();
  const seeds = life.config.crops
    .map((c) => ({ crop: c, n: items.filter((i) => i.itemId === c.item).reduce((s, i) => s + (i.count ?? 1), 0) }))
    .filter((s) => s.n > 0);
  return (
    <div className="plant-panel">
      <header>Ruộng trống<b>Gieo trồng</b></header>
      {seeds.length ? (
        <div className="plant-grid">
          {seeds.map(({ crop, n }) => (
            <button key={crop.id} className="plant-slot" title={`Trồng ${itemName(crop.item)}`} disabled={busy('plant')} onClick={() => onPlant(crop.id)}>
              {busy('plant') && <span className="inv-cache-busy"><Spinner /></span>}
              {itemIcons.get(crop.item) ? <img src={itemIcons.get(crop.item)} alt="" /> : itemName(crop.item)}
              <b>{n}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className="plant-empty">Không có hạt giống. Mua khoai tây ở Bác Ba.</div>
      )}
      <small>Đứng yên {Math.round(life.config.plantingMs / 1000)} giây để trồng</small>
    </div>
  );
}

/** Vertical tabs beside the NPC dialogue / inventory: hop between the two. */
export function SideTabs({ active, onQuests, onInventory }: { active: 'quests' | 'inventory'; onQuests: () => void; onInventory: () => void }) {
  return (
    <nav className="side-tabs">
      <button className={active === 'quests' ? 'on' : ''} onClick={onQuests} title="Nhiệm vụ">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 3h9l3 3v15H6z M9 9h6 M9 13h6 M9 17h4" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        <span>Nhiệm vụ</span>
      </button>
      <button className={active === 'inventory' ? 'on' : ''} onClick={onInventory} title="Kho đồ">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 8h14v12H5z M9 8V5h6v3 M5 13h14" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        <span>Kho đồ</span>
      </button>
    </nav>
  );
}

/** Knocked down: the bleed-out bar, a call for help (nearby players get an arrow) and giving up. */
export function DownedPanel({ bleed, onHelp, onGiveUp }: { bleed: number; onHelp: () => void; onGiveUp: () => void }) {
  const [calledAt, setCalledAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const wait = Math.max(0, Math.ceil((calledAt + 10_000 - now) / 1000));
  return (
    <div className="downed-overlay">
      <div className="downed-card">
        <h2>Bạn đã gục</h2>
        <p>Chờ đồng đội tới cấp cứu trước khi mất hết máu.</p>
        <div className="downed-bar"><div style={{ width: `${Math.max(0, Math.min(100, bleed))}%` }} /></div>
        <small>Máu cấp cứu {Math.round(bleed)} · còn khoảng {Math.ceil((bleed / 100) * 60)} giây</small>
        <div className="downed-actions">
          <button className="btn btn-primary" disabled={wait > 0} onClick={() => { setCalledAt(Date.now()); onHelp(); }}>{wait > 0 ? `Đã gọi (${wait}s)` : 'Gọi cấp cứu'}</button>
          <button className="btn q-btn-danger" onClick={() => { if (confirm('Tự sát? Mọi nhiệm vụ đang làm sẽ bị hủy và mất vật phẩm nhiệm vụ.')) onGiveUp(); }}>Tự sát</button>
        </div>
      </div>
    </div>
  );
}

/** Reviving a downed player: stay put until the bar fills. */
export function ReviveBar({ start, end }: { start: number; end: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 50);
    return () => clearInterval(t);
  }, []);
  const done = Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
  return (
    <div className="revive-bar">
      Đang cấp cứu <small>(đứng yên)</small>
      <div><i style={{ width: `${done * 100}%` }} /></div>
    </div>
  );
}

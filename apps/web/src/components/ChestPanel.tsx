'use client';
import { useEffect, useRef, useState } from 'react';
import { ARMOR_BY_ITEM, CHEST_SEARCH_MS, ITEMS, isStash, maxCount, sellPrice, type PlacedItem } from '@zion/shared';
import type { InventoryState, InventoryStore } from '@/game/inventory/inventory';
import { itemIconFor } from '@/game/inventory/icons';
import { useSettings } from '@/lib/settings';
import { Icon } from './Icon';
import type { Tip } from './Inventory';

type Tier = 'common' | 'rare' | 'epic' | 'legendary';
const ELITE = new Set(['awm', 'm4a1', 'aug', 'svd', 'saiga12', 'grenade_launcher', 'm79', 'remington700', 'rocket_launcher', 'flamethrower', 'nuclear_cell']);
const WEAPON = new Set(['rifle', 'pistol', 'smg', 'shotgun', 'heavy', 'melee']);
function tierOf(id: string): Tier {
  const armor = ARMOR_BY_ITEM.get(id)?.rarity;
  if (ELITE.has(id) || armor === 'legendary') return 'legendary';
  if (armor === 'epic' || armor === 'rare') return 'epic';
  if (armor || WEAPON.has(ITEMS[id]?.category ?? '')) return 'rare';
  return 'common';
}
/** Identification time per item: better loot keeps the player in suspense longer. */
const REVEAL_MS: Record<Tier, number> = { common: 550, rare: 1100, epic: 1500, legendary: 2000 };

/** `grid`: battle royale crates — an open slot grid, no search, no prices. */
export function ChestPanel({ state, store, grid = false, onTip }: { state: InventoryState; store: InventoryStore; grid?: boolean; onTip?: (tip: Tip | null) => void }) {
  // Hovering any item shows the same detailed tooltip as the bag grid.
  const tip = (i: PlacedItem) => ({ onMouseEnter: () => { const def = ITEMS[i.itemId]; if (def) onTip?.({ def, count: i.count, issued: i.issued }); }, onMouseLeave: () => onTip?.(null) });
  const c = state.chest;
  const { item } = useSettings();
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const end = performance.now() + (c?.searchRemainingMs ?? 0);
    const update = () => setRemaining(Math.max(0, end - performance.now()));
    update(); const timer = window.setInterval(update, 100); return () => clearInterval(timer);
  }, [c]);
  // Items that appear from a search are revealed one at a time, each staying "unidentified"
  // for a beat that grows with its rarity.
  const [hidden, setHidden] = useState<number[]>([]);
  const seen = useRef<{ id: string; uids: Set<number>; searching: boolean } | null>(null);
  useEffect(() => {
    if (!c) return;
    const prev = seen.current;
    const uids = new Set(c.items.map((i) => i.uid));
    if (prev && prev.id === c.id && prev.searching && c.searched) {
      const fresh = c.items.filter((i) => !prev.uids.has(i.uid)).map((i) => i.uid);
      if (fresh.length) setHidden((h) => [...h, ...fresh]);
    }
    seen.current = { id: c.id, uids, searching: c.searchRemainingMs > 0 || (prev?.id === c.id && prev.searching && !c.searched) };
  }, [c]);
  useEffect(() => {
    if (!hidden.length || !c) return;
    const head = c.items.find((i) => i.uid === hidden[0]);
    const t = window.setTimeout(() => setHidden((h) => h.slice(1)), head ? REVEAL_MS[tierOf(head.itemId)] : 0);
    return () => clearTimeout(t);
  }, [hidden, c]);
  if (!c) return <section className="inv-box shared-chest"><header><Icon name="game-icons:locked-chest" /> Hòm gỗ</header><button className="btn" onClick={() => store.setOpen(false)}>Đóng</button></section>;
  const locked = c.busy || c.searchRemainingMs > 0;
  const revealing = hidden.length > 0;
  /** Shop buy-back value; 0 when the merchant won't take it. */
  const price = (i: PlacedItem) => {
    if (grid || i.issued || i.quest) return 0;
    const max = maxCount(ITEMS[i.itemId]!);
    return sellPrice(i.itemId, max && i.count !== undefined ? i.count / max : 1);
  };
  const art = (i: PlacedItem) => {
    const src = itemIconFor(i.itemId, i.attachments);
    return src ? <img src={src} alt="" draggable={false} /> : <Icon name="game-icons:cardboard-box" />;
  };
  return <section className="inv-box shared-chest">
    <header><span><Icon name="game-icons:locked-chest" /> {grid ? 'Hòm vũ khí' : 'Hòm gỗ'}</span><small>{c.items.length}/{c.capacity}</small></header>
    {c.error && <p className="chest-error" role="alert">{c.error}</p>}
    {grid && <div className="chest-grid" style={{ ['--slots' as string]: Math.min(6, c.capacity) }}>
      {Array.from({ length: c.capacity }, (_, n) => {
        const i = c.items[n];
        if (!i) return <div className="chest-slot empty" key={`e${n}`} />;
        const amount = i.mag !== undefined ? `${i.mag}` : i.count !== undefined ? `x${i.count}` : '';
        return <button type="button" {...tip(i)} className={`chest-slot t-${tierOf(i.itemId)}`} key={`${c.id}:${i.uid}`} disabled={locked || !!state.held} onMouseDown={(e) => e.stopPropagation()} onClick={() => store.chestAction('chestTake', i.uid)}>
          {art(i)}<span>{item(i.itemId)}</span>{amount && <small>{amount}</small>}
        </button>;
      })}
    </div>}
    {!grid && c.field && <div className="chest-search">
      <button className="btn btn-primary" disabled={locked || c.searched || c.items.length >= c.capacity} onClick={() => store.chestAction('chestSearch')}>
        <Icon name="lucide:search" /> {c.busy ? '...' : c.searchRemainingMs > 0 ? `${(remaining / 1000).toFixed(1)}s` : c.searched ? 'Đã Search' : 'Search'}
      </button>
      {c.searchRemainingMs > 0 && <div className="chest-search-track"><div style={{ width: `${100 * (1 - remaining / CHEST_SEARCH_MS)}%` }} /></div>}
    </div>}
    
    {!grid && <div className="chest-items">
      {c.items.map((i) => {
        const tier = tierOf(i.itemId);
        const pending = hidden.indexOf(i.uid);
        if (pending > 0) return <div className="chest-item chest-unknown" key={`${c.id}:${i.uid}`}><Icon name="lucide:search" /><span><b>???</b><small>Chờ xác định</small></span></div>;
        if (pending === 0) return <div className={`chest-item chest-unknown scanning t-${tier}`} key={`${c.id}:${i.uid}`} style={{ ['--reveal' as string]: `${REVEAL_MS[tier]}ms` }}><Icon name="lucide:search" /><span><b>Đang xác định...</b><i className="chest-scan" /></span></div>;
        return <div className={`chest-item t-${tier}`} key={`${c.id}:${i.uid}`} {...tip(i)}>
          {art(i)}<span><b>{item(i.itemId)}</b><small>{i.mag !== undefined ? `${i.mag} viên` : i.count !== undefined ? `x${i.count}` : ''}</small></span>
          {price(i) > 0 && <em className="chest-price">{price(i)} ZC</em>}
          <button className="btn" disabled={locked || revealing || !!state.held} onMouseDown={(e) => e.stopPropagation()} onClick={() => store.chestAction('chestTake', i.uid)}><Icon name="lucide:arrow-left" /> Lấy</button>
        </div>;
      })}
      {!c.items.length && <div className="chest-empty"><Icon name="game-icons:open-chest" />Trống</div>}
    </div>}
    <h4>Cất vào</h4>
    <div className="chest-deposit">
      {state.items.filter((i) => !isStash(i.container)).map((i) => <button className="chest-put" key={i.uid} {...tip(i)} disabled={locked || !!state.held || c.items.length >= c.capacity} onMouseDown={(e) => e.stopPropagation()} onClick={() => store.chestAction('chestPut', i.uid)}>
        {art(i)}<span>{item(i.itemId)}</span>{price(i) > 0 && <em className="chest-price">{price(i)} ZC</em>}<Icon name="lucide:arrow-right" />
      </button>)}
    </div>
  </section>;
}

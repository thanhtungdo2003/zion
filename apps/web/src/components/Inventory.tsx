'use client';
import { Icon } from './Icon';
import { ChestPanel } from './ChestPanel';

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  CONTAINERS,
  canPlace,
  footprint,
  hotbar,
  type ContainerId,
  type InventoryState,
  type InventoryStore,
  type PlacedItem,
} from '@/game/inventory/inventory';
import { itemIcons } from '@/game/inventory/icons';
import { usePending } from '@/game/pending';
import { Spinner } from './Spinner';
import { ARMOR_BY_ITEM, ARMOR_SLOTS, NURSE_HEAL_PRICE, NURSE_NAME, RARITY_COLOR, SHOP_STOCK, WEAPON_BY_ITEM, WEAPON_SPECS, armorProtection, armorSpeedFactor, buyPrice, sellPrice, isStash, type ShopCategory, type WeaponId, ARMOR_BY_ID } from '@zion/shared';
import { useSettings } from '@/lib/settings';
import { itemDescription } from '@/lib/i18n';
import { CACHE_DRAWS_PER_DAY, CACHE_STOCK, CAMP_CACHE_STOCK, ITEMS, maxCount, type ItemDef } from '@/game/inventory/items';

type Tr = ReturnType<typeof useSettings>;

/** Item descriptions use the same locale as the rest of the inventory. */
function itemInfo(tr: Tr, def: ItemDef): string {
  return itemDescription(tr.lang, def.id);
}

/** Grid cell size (px): scaled so the inventory fills ~90% of the screen (set by the panel). */
let CELL = 44;

/** Cell size that fits the bento layout (16 cells wide + side panel, ~11 rows tall) in 90% of the window. */
function fitCell(withSide: boolean): number {
  if (typeof window === 'undefined') return 44;
  // Two 8-cell columns side by side; the right one stacks equipment (4 rows) over the backpack (5).
  const w = window.innerWidth * 0.9 - 90 - (withSide ? 400 : 0);
  const h = window.innerHeight * 0.9 - 190;
  return Math.max(30, Math.min(80, Math.floor(Math.min(w / 16, h / 9))));
}

/** Hover info: the item definition plus its per-item metadata. */
type Tip = { def: ItemDef; count?: number; equipped?: boolean; issued?: boolean };

/** Stat rows for the tooltip, from the shared weapon table and the item's metadata. */
function tipRows(t: Tip, tr: Tr): Array<[string, string]> {
  const { def } = t;
  const L = tr.t;
  const rows: Array<[string, string]> = [[L('tip.type'), L(`cat.${def.category}`)], [L('tip.size'), `${def.w}×${def.h}`]];
  if (def.ammo) {
    rows.push([L('tip.rounds'), `${t.count ?? def.ammo.capacity} / ${def.ammo.capacity}`]);
    rows.push([L('tip.for'), def.ammo.guns.map((g) => tr.item(g)).join(', ')]);
  }
  if (def.uses) rows.push([L('tip.uses'), `${t.count ?? def.uses} / ${def.uses}`]);
  const arm = ARMOR_BY_ITEM.get(def.id);
  if (arm) {
    const dur = t.count ?? arm.durability;
    rows.push([L('tip.rarity'), L(`rarity.${arm.rarity}`)]);
    rows.push([L('tip.protection'), `−${Math.round(arm.protection * 100)}%`]);
    rows.push([L('tip.durability'), dur <= 0 ? L('tip.broken') : `${Math.ceil(dur)} / ${arm.durability}`]);
    rows.push([L('tip.weight'), `${arm.weight} kg`]);
  }
  const w = WEAPON_BY_ITEM[def.id];
  const spec = w ? WEAPON_SPECS[w as Exclude<WeaponId, 0>] : undefined;
  if (spec?.kind === 'gun') {
    const blast = spec.projectile?.blast;
    if (blast) {
      rows.push([L('tip.damage'), L('tip.center', { n: blast.damage })]);
      rows.push([L('tip.blast'), `${blast.radius} m`]);
    } else if (spec.fire === 'flame') {
      rows.push([L('tip.damage'), L('tip.flame_dmg', { n: Math.round((spec.damage * 1000) / spec.fireMs) })]);
      if (spec.burn) rows.push([L('tip.burn'), L('tip.burn_val', { dps: spec.burn.dps, s: spec.burn.seconds })]);
    } else rows.push([L('tip.damage'), spec.pellets > 1 ? `${spec.damage} × ${spec.pellets}` : `${spec.damage}`]);
    rows.push([L('tip.fire_rate'), L('tip.rpm', { rpm: Math.round(60000 / spec.fireMs), mode: L(spec.auto ? 'tip.auto' : 'tip.semi') })]);
    rows.push([L('tip.magazine'), `${spec.magazine}`]);
    rows.push([L('tip.range'), `${spec.range} m`]);
    rows.push([L('tip.spread'), `${((spec.spread * 180) / Math.PI).toFixed(1)}°`]);
    rows.push([L('tip.reload'), `${(spec.reloadMs / 1000).toFixed(1)} s`]);
    const ammo = Object.values(ITEMS).find((d) => d.ammo?.guns.includes(def.id));
    if (ammo) rows.push([L('tip.ammo'), tr.item(ammo.id)]);
  } else if (spec?.kind === 'melee') {
    rows.push([L('tip.damage'), `${spec.damage}`]);
    rows.push([L('tip.reach'), `${spec.range} m`]);
    rows.push([L('tip.swing'), L('tip.per_min', { n: Math.round(60000 / spec.cooldownMs) })]);
  } else if (spec?.kind === 'throw') {
    rows.push([L('tip.damage'), L('tip.center', { n: spec.damage })]);
    rows.push([L('tip.blast'), `${spec.radius} m`]);
    rows.push([L('tip.fuse'), `${(spec.fuseMs / 1000).toFixed(1)} s`]);
    rows.push([L('tip.max_throw'), `${spec.maxRange} m`]);
  }
  if (t.equipped) rows.push([L('tip.status'), L('tip.in_hand')]);
  const price = buyPrice(def.id);
  if (price !== null) {
    rows.push([L('tip.price'), `${price} ZC`]);
    rows.push([L('tip.sell'), t.issued ? L('tip.issued') : `${sellPrice(def.id, maxCount(def) && t.count !== undefined ? t.count / maxCount(def)! : 1)} ZC`]);
  } else if (t.issued) rows.push([L('tip.sell'), L('tip.issued')]);
  return rows;
}

function Tooltip({ tip, x, y }: { tip: Tip; x: number; y: number }) {
  const tr = useSettings();
  const left = Math.min(x + 16, window.innerWidth - 240);
  const top = Math.min(y + 16, window.innerHeight - 260);
  return (
    <div className="inv-tip" style={{ left, top }}>
      <div className="inv-tip-name">{tr.item(tip.def.id)}</div>
      <div className="inv-tip-info">{itemInfo(tr, tip.def)}</div>
      <table>
        <tbody>
          {tipRows(tip, tr).map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The item's real 3D model, pre-rendered at load; items without a model fall back to a silhouette. */
function ItemArt({ def }: { def: ItemDef }) {
  const { item } = useSettings();
  const src = itemIcons.get(def.id);
  if (src) return <img src={src} alt={item(def.id)} className="inv-sil" draggable={false} />;
  return <Silhouette def={def} />;
}

/** Fallback flat silhouette for items that have no model yet. */
function Silhouette({ def }: { def: ItemDef }) {
  const fill = 'rgba(232,228,218,0.85)';
  switch (def.category) {
    case 'grenade':
      return (
        <svg viewBox="0 0 40 40" className="inv-sil">
          <ellipse cx="20" cy="24" rx="11" ry="13" fill={fill} />
          <rect x="15" y="6" width="10" height="7" rx="1" fill={fill} />
          <path d="M25 9 q8 -2 8 8" stroke={fill} strokeWidth="2.5" fill="none" />
        </svg>
      );
    case 'pistol':
      return (
        <svg viewBox="0 0 40 40" className="inv-sil">
          <rect x="4" y="9" width="32" height="9" rx="1.5" fill={fill} />
          <path d="M8 18 h12 l-3 16 h-9 z" fill={fill} />
          <path d="M20 18 q3 5 -2 6" stroke={fill} strokeWidth="2" fill="none" />
        </svg>
      );
    case 'smg':
      return (
        <svg viewBox="0 0 60 40" className="inv-sil">
          <rect x="8" y="10" width="42" height="10" rx="1.5" fill={fill} />
          <rect x="50" y="13" width="8" height="4" fill={fill} />
          <rect x="24" y="20" width="6" height="16" fill={fill} />
          <path d="M14 20 h7 l-3 12 h-6 z" fill={fill} />
          <path d="M8 13 h-6 v8 h6" stroke={fill} strokeWidth="2.5" fill="none" />
        </svg>
      );
    default: {
      const shotgun = def.category === 'shotgun';
      const heavy = def.category === 'heavy';
      return (
        <svg viewBox="0 0 100 40" className="inv-sil">
          <path d="M2 14 h22 v12 l-16 6 h-6 z" fill={fill} />
          <rect x="24" y="12" width="34" height="11" rx="1.5" fill={fill} />
          <rect x="58" y="15" width={shotgun ? 40 : 36} height={shotgun ? 6 : 4} fill={fill} />
          {shotgun ? (
            <rect x="58" y="22" width="26" height="5" rx="2" fill={fill} />
          ) : heavy ? (
            <>
              <rect x="34" y="23" width="14" height="10" rx="2" fill={fill} />
              <path d="M80 19 l-6 16 M80 19 l6 16" stroke={fill} strokeWidth="2" />
            </>
          ) : (
            <path d="M40 23 h8 q4 10 -2 14 h-6 q4 -6 0 -14 z" fill={fill} />
          )}
          <path d="M26 23 h6 l-2 10 h-6 z" fill={fill} />
        </svg>
      );
    }
  }
}

function ItemTile({ def, rotated, count, style, className }: { def: ItemDef; rotated: boolean; count?: number; style?: React.CSSProperties; className?: string }) {
  const { w, h } = footprint(def, rotated);
  const { item } = useSettings();
  return (
    <div className={`inv-item ${className ?? ''}`} style={{ width: w * CELL - 4, height: h * CELL - 4, background: def.color, ...style }}>
      <div
        className="inv-item-art"
        style={rotated ? { width: h * CELL - 4, height: w * CELL - 4, transform: 'rotate(90deg)' } : { width: '100%', height: '100%' }}
      >
        <ItemArt def={def} />
      </div>
      <span className="inv-item-name">{item(def.id)}</span>
      {def.armor && (
        <div className="inv-dur">
          <div style={{ width: `${Math.max(0, Math.min(1, (count ?? def.armor.durability) / def.armor.durability)) * 100}%`, background: durabilityColor((count ?? def.armor.durability) / def.armor.durability) }} />
        </div>
      )}
      {maxCount(def) ? (
        <span className="inv-item-size inv-item-count">
          {Math.ceil(count ?? maxCount(def)!)}/{maxCount(def)}
        </span>
      ) : (
        <span className="inv-item-size">
          {def.w}×{def.h}
        </span>
      )}
    </div>
  );
}

/** Cell of the item that was grabbed, so it stays under the cursor while dragging. */
type Grab = { dx: number; dy: number };

const DOUBLE_CLICK_MS = 320;

interface GridProps {
  id: ContainerId;
  state: InventoryState;
  store: InventoryStore;
  hover: { container: ContainerId; x: number; y: number } | null;
  onHover: (h: { container: ContainerId; x: number; y: number } | null) => void;
  grab: Grab;
  onGrab: (g: Grab) => void;
  lastDown: { current: { uid: number; t: number } | null };
  onTip: (t: Tip | null) => void;
}

function Grid({ id, state, store, hover, onHover, grab, onGrab, lastDown, onTip }: GridProps) {
  const { t } = useSettings();
  const c = CONTAINERS[id];
  const held = state.held;
  const items = state.items.filter((i) => i.container === id);
  const heldDef = held ? ITEMS[held.itemId]! : null;
  const fp = heldDef ? footprint(heldDef, held!.rotated) : { w: 1, h: 1 };

  // Anchor the held item on the cell it was grabbed by (clamped after a rotation).
  const anchorOf = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = Math.floor((e.clientX - r.left) / CELL);
    const cy = Math.floor((e.clientY - r.top) / CELL);
    return { cx, cy, x: cx - Math.min(grab.dx, fp.w - 1), y: cy - Math.min(grab.dy, fp.h - 1) };
  };

  // Press on an item: drag it. Double press: send it between backpack and hands.
  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || held) return;
    e.stopPropagation();
    const { cx, cy } = anchorOf(e);
    const target = items.find((i) => {
      const f = footprint(ITEMS[i.itemId]!, i.rotated);
      return cx >= i.x && cx < i.x + f.w && cy >= i.y && cy < i.y + f.h;
    });
    if (!target) return;
    const now = performance.now();
    const prev = lastDown.current;
    if (e.shiftKey || (prev && prev.uid === target.uid && now - prev.t < DOUBLE_CLICK_MS)) {
      lastDown.current = null;
      store.quickMove(target.uid);
      return;
    }
    lastDown.current = { uid: target.uid, t: now };
    onGrab({ dx: cx - target.x, dy: cy - target.y });
    store.pickUp(target.uid);
  };

  // Release over a grid: place it there, or put it back where it came from if it doesn't fit.
  const onMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !held) return;
    e.stopPropagation();
    const { x, y } = anchorOf(e);
    if (!store.drop(id, x, y)) store.returnHeld();
  };

  const preview = held && hover?.container === id ? hover : null;
  const ok = preview && canPlace(state.items, id, held!.itemId, preview.x, preview.y, held!.rotated);
  const accepted = c.accepts === 'all' ? t('inv.anything') : c.accepts.map((a) => t(`cat.${a}`)).join(' · ');
  const dim = heldDef && c.accepts !== 'all' && !c.accepts.includes(heldDef.category);

  return (
    <section className={`inv-box inv-${id} ${dim ? 'inv-dim' : ''}`}>
      <header>
        <span>{t(`cont.${id}`)}</span>
        <small>{accepted}</small>
      </header>
      <div
        className="inv-grid"
        style={{ width: c.cols * CELL, height: c.rows * CELL, backgroundSize: `${CELL}px ${CELL}px` }}
        onMouseMove={(e) => {
          const { x, y } = anchorOf(e);
          if (hover?.container !== id || hover.x !== x || hover.y !== y) onHover({ container: id, x, y });
          if (held) return onTip(null);
          const r = e.currentTarget.getBoundingClientRect();
          const cx = Math.floor((e.clientX - r.left) / CELL);
          const cy = Math.floor((e.clientY - r.top) / CELL);
          const under = items.find((i) => {
            const f = footprint(ITEMS[i.itemId]!, i.rotated);
            return cx >= i.x && cx < i.x + f.w && cy >= i.y && cy < i.y + f.h;
          });
          onTip(under ? { def: ITEMS[under.itemId]!, count: under.count, equipped: state.equipped === under.uid, issued: under.issued } : null);
        }}
        onMouseLeave={() => {
          onHover(null);
          onTip(null);
        }}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          // Touch uses tap-to-pick, then tap-to-place; suppress compatibility mouse events.
          e.preventDefault();
          if (held) onMouseUp(e);
          else onMouseDown(e);
        }}
        onContextMenu={(e) => {
          // Right-click a first aid kit to use it, or food to eat it.
          e.preventDefault();
          if (held) return;
          const r = e.currentTarget.getBoundingClientRect();
          const cx = Math.floor((e.clientX - r.left) / CELL);
          const cy = Math.floor((e.clientY - r.top) / CELL);
          const under = items.find((i) => {
            const f = footprint(ITEMS[i.itemId]!, i.rotated);
            return cx >= i.x && cx < i.x + f.w && cy >= i.y && cy < i.y + f.h;
          });
          // Started first aid: close the inventory so the bandaging can be seen.
          if (under?.itemId === 'medkit' && store.onUseMedkit?.(under.uid)) store.setOpen(false);
          else if (under) store.onEat?.(under.uid);
        }}
      >
        {items.map((i: PlacedItem) => (
          <ItemTile
            key={i.uid}
            def={ITEMS[i.itemId]!}
            rotated={i.rotated}
            count={i.count}
            className={`${state.equipped === i.uid ? 'inv-equipped' : ''} ${i.quest ? 'inv-quest' : ''}`}
            style={{ position: 'absolute', left: i.x * CELL + 2, top: i.y * CELL + 2 }}
          />
        ))}
        {preview && (
          <div
            className={`inv-preview ${ok ? 'ok' : 'bad'}`}
            style={{ left: preview.x * CELL, top: preview.y * CELL, width: fp.w * CELL, height: fp.h * CELL }}
          />
        )}
      </div>
    </section>
  );
}

/** Bento inventory panel (E). Drag & drop to move, R rotates while dragging, double-click quick-moves. */
export function InventoryPanel({ state, store, coins, side }: { state: InventoryState; store: InventoryStore; coins: number; side?: React.ReactNode }) {
  const busy = usePending();
  const { t, item, touchControls } = useSettings();
  const [mouse, setMouse] = useState({ x: -999, y: -999 });
  const [hover, setHover] = useState<{ container: ContainerId; x: number; y: number } | null>(null);
  const [grab, setGrab] = useState<Grab>({ dx: 0, dy: 0 });
  const lastDown = useRef<{ uid: number; t: number } | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  CELL = fitCell(!!state.station);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyR') store.rotateHeld();
      else if (e.code === 'KeyE' || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (state.held && e.code === 'Escape') store.returnHeld();
        else store.setOpen(false);
      }
    };
    // Released outside the panel: thrown out onto the ground. Elsewhere in the panel: put back.
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const inPanel = e.target instanceof Element && e.target.closest('.inv-panel');
      if (inPanel) store.returnHeld();
      else store.throwHeld();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [store, state.held]);

  const heldDef = state.held ? ITEMS[state.held.itemId]! : null;
  const fp = heldDef ? footprint(heldDef, state.held!.rotated) : null;

  return (
    <div className="inv-overlay" onContextMenu={(e) => e.preventDefault()}>
      <div className="inv-wrap">
      {side}
      <div className="inv-panel">
        <div className="inv-title">
          <h2>{t('inv.title')}</h2>
          <Coins n={coins} />
          <button type="button" className="inv-close" aria-label={t('inv.close')} onClick={() => store.setOpen(false)}><Icon name="lucide:x" /></button>
          {touchControls && state.held && <div className="inv-touch-actions" onMouseUp={(e) => e.stopPropagation()}>
            <button type="button" className="inv-close" aria-label={t('inv.rotate')} onClick={() => store.rotateHeld()}><Icon name="lucide:rotate-cw" /></button>
            <button type="button" className="inv-close" aria-label={t('inv.swap')} onClick={() => { const uid = state.held!.uid; store.returnHeld(); store.quickMove(uid); }}><Icon name="lucide:arrow-left-right" /></button>
            {heldDef?.category === 'food' && <button type="button" className="inv-close" aria-label={t('inv.use')} onClick={() => { const uid = state.held!.uid; store.returnHeld(); if (store.onEat?.(uid)) store.setOpen(false); }}><Icon name="lucide:utensils" /></button>}
            <button type="button" className="inv-close" aria-label={t('inv.close')} onClick={() => store.returnHeld()}><Icon name="lucide:undo-2" /></button>
          </div>}
          {process.env.NODE_ENV !== 'production' && (
            <button className="btn inv-dev-coins" title={t('inv.dev_coins')} onClick={() => store.onDevCoins?.()}>
              +
            </button>
          )}
          <div className="keys">
            <kbd>{t('inv.drag')}</kbd> {t('inv.move')} · <kbd>R</kbd> {t('inv.rotate')} · <kbd>{t('inv.dblclick')}</kbd> {t('inv.swap')} · {t('inv.drop_hint')} · {t('inv.use')} ·{' '}
            <kbd>E</kbd> {t('inv.close')}
          </div>
        </div>
        <div className="inv-bento">
          <div className="inv-col">
            <Grid id="heavy" state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} />
            <Grid id="primary" state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} />
            <div className="inv-row">
              <Grid id="secondary" state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} />
              <div className="inv-col">
                <Grid id="grenades" state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} />
                <Grid id="offhand" state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} />
              </div>
            </div>
          </div>
          <div className="inv-col">
            <EquipmentPanel state={state} store={store} grid={(id) => <Grid id={id} state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} />} />
            <Grid id="backpack" state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} />
          </div>
          {state.station === 'stash' && <StashPanel grid={(id) => <Grid id={id} state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} />} items={state.items} />}
          {state.station === 'shop' && <ShopPanel state={state} store={store} coins={coins} onTip={setTip} />}
          {state.station === 'nurse' && <NursePanel store={store} coins={coins} onTip={setTip} />}
          {state.station === 'chest' && <ChestPanel state={state} store={store} />}
          {state.station && state.station !== 'shop' && state.station !== 'nurse' && state.station !== 'stash' && state.station !== 'chest' && (
            <section className="inv-box inv-cache">
              <header>
                <span>{t(state.station === 'camp' ? 'inv.camp_title' : 'inv.cache_title')}</span>
                <small className={state.cacheLeft <= 0 ? 'inv-cache-out' : undefined}>{t('inv.cache_left', { n: Math.max(0, state.cacheLeft), max: CACHE_DRAWS_PER_DAY })}</small>
              </header>
              <div className="inv-cache-list">
                {(state.station === 'camp' ? CAMP_CACHE_STOCK : CACHE_STOCK).map((id) => {
                  const def = ITEMS[id]!;
                  return (
                    <button
                      key={id}
                      className="inv-cache-item"
                      style={{ background: def.color }}
                      onMouseEnter={() => setTip({ def })}
                      onMouseLeave={() => setTip(null)}
                      onMouseDown={(e) => e.stopPropagation()}
                      disabled={busy(`cache:${id}`) || state.cacheLeft <= 0}
                      onClick={() => setFull(store.takeFromCache(id) ? null : id)}
                    >
                      {busy(`cache:${id}`) && <span className="inv-cache-busy"><Spinner /></span>}
                      <span className="inv-cache-art">
                        <ItemArt def={def} />
                      </span>
                      <span className="inv-cache-name">{item(id)}</span>
                      <small>{def.ammo ? t('inv.rds', { n: def.ammo.capacity }) : `${def.w}×${def.h}`}</small>
                    </button>
                  );
                })}
              </div>
              {full && <div className="inv-cache-full">{t('inv.cache_full', { item: item(full) })}</div>}
            </section>
          )}
        </div>
      </div>
      </div>
      {tip && !state.held && <Tooltip tip={tip} x={mouse.x} y={mouse.y} />}
      {heldDef && fp && (
        <ItemTile
          def={heldDef}
          rotated={state.held!.rotated}
          count={state.held!.count}
          className="inv-held"
          style={{
            position: 'fixed',
            left: mouse.x - (Math.min(grab.dx, fp.w - 1) + 0.5) * CELL,
            top: mouse.y - (Math.min(grab.dy, fp.h - 1) + 0.5) * CELL,
          }}
        />
      )}
    </div>
  );
}

/** Character viewer wearing the equipped armour, the four armour slots and the set's totals. */
function EquipmentPanel({ state, store, grid }: { state: InventoryState; store: InventoryStore; grid: (id: ContainerId) => React.ReactNode }) {
  const { t } = useSettings();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !store.preview) return;
    return store.preview.mount(host.current);
  }, [store]);
  const worn = store.wornArmor();
  void state;
  let kg = 0;
  for (const s of ARMOR_SLOTS) kg += ARMOR_BY_ID.get(worn[s])?.weight ?? 0;
  return (
    <section className="inv-box inv-equip" style={{ width: 8 * CELL + 2 }}>
      <header>
        <span>{t('inv.equipment')}</span>
        <small className="inv-equip-stats">
          <Icon name="game-icons:shield" /> <b>−{Math.round(armorProtection(worn) * 100)}%</b> · <Icon name="lucide:weight" /> <b>{kg.toFixed(1)} kg</b> · {t('inv.speed')} <b>{Math.round(armorSpeedFactor(worn) * 100)}%</b>
        </small>
      </header>
      <div className="inv-equip-body">
        <div className="inv-equip-col">
          {grid('armor_head')}
          {grid('armor_chest')}
        </div>
        <div className="inv-equip-view" ref={host} style={{ width: 4 * CELL - 16, height: 4 * CELL }} />
        <div className="inv-equip-col">
          {grid('armor_legs')}
          {grid('armor_feet')}
        </div>
      </div>
    </section>
  );
}

const SHOP_TABS: ShopCategory[] = ['guns', 'heavy', 'melee', 'explosives', 'ammo', 'armor', 'tools'];

/** The ZCoin gold coin (its 3D model, pre-rendered), with the amount. */
export function Coins({ n, className }: { n: number; className?: string }) {
  const src = itemIcons.get('zcoin');
  return (
    <span className={`zcoin ${className ?? ''}`}>
      {src ? <img src={src} alt="ZCoin" draggable={false} /> : <i className="zcoin-dot" />}
      <b>{n.toLocaleString()}</b>
    </span>
  );
}

/** Personal camp storage: three pages; drag items between the bag and a page. */
function StashPanel({ grid, items }: { grid: (id: ContainerId) => React.ReactNode; items: readonly PlacedItem[] }) {
  const [page, setPage] = useState(0);
  const pages = ['stash_1', 'stash_2', 'stash_3'] as const;
  return (
    <section className="inv-box inv-stash">
      <header>
        <span>Kho cá nhân</span>
        <small>Chỉ mở được tại khu kho của căn cứ</small>
      </header>
      <div className="stash-tabs">
        {pages.map((id, i) => (
          <button key={id} className={page === i ? 'on' : ''} onClick={() => setPage(i)}>
            Trang {i + 1} <small>{items.filter((it) => it.container === id).length}</small>
          </button>
        ))}
      </div>
      {grid(pages[page]!)}
    </section>
  );
}

/** Field medic: a paid full heal, and first aid kits for the road. */
function NursePanel({ store, coins, onTip }: { store: InventoryStore; coins: number; onTip: (t: Tip | null) => void }) {
  const busy = usePending();
  const { t, item } = useSettings();
  const kits = SHOP_STOCK.filter((e) => e.vendor === 'medic');
  return (
    <section className="inv-box inv-shop">
      <header>
        <span>{NURSE_NAME}</span>
        <Coins n={coins} />
      </header>
      <div className="shop-list">
        <div className="shop-row">
          <span className="shop-art nurse-cross"><Icon name="game-icons:medical-pack" /></span>
          <span className="shop-name">
            {t('nurse.heal')}
            <small>{t('nurse.heal_sub')}</small>
          </span>
          <Coins n={NURSE_HEAL_PRICE} className={coins >= NURSE_HEAL_PRICE ? '' : 'short'} />
          <button data-nosound className="btn shop-btn" disabled={coins < NURSE_HEAL_PRICE || busy('nurseheal')} onMouseDown={(ev) => ev.stopPropagation()} onClick={() => store.onNurseHeal?.()}>
            {busy('nurseheal') ? <Spinner /> : t('nurse.heal_btn')}
          </button>
        </div>
        {kits.map((e) => {
          const def = ITEMS[e.item];
          if (!def) return null;
          return (
            <div key={e.item} className="shop-row" onMouseEnter={() => onTip({ def })} onMouseLeave={() => onTip(null)}>
              <span className="shop-art" style={{ background: def.color }}>
                <ItemArt def={def} />
              </span>
              <span className="shop-name">
                {item(e.item)}
                <small>{`${def.w}×${def.h}`}</small>
              </span>
              <Coins n={e.price} className={coins >= e.price ? '' : 'short'} />
              <button data-nosound className="btn shop-btn" disabled={coins < e.price || busy(`buy:${e.item}`)} onMouseDown={(ev) => ev.stopPropagation()} onClick={() => store.onBuy?.(e.item)}>
                {busy(`buy:${e.item}`) ? <Spinner /> : t('shop.buy')}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Weapon merchant: buy from his stock or sell what you carry, paid in ZCoin (server wallet). */
function ShopPanel({ state, store, coins, onTip }: { state: InventoryState; store: InventoryStore; coins: number; onTip: (t: Tip | null) => void }) {
  const busy = usePending();
  const { t, item } = useSettings();
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [tab, setTab] = useState<ShopCategory>('guns');
  const saleItems = state.items.flatMap((i) => {
    const def = ITEMS[i.itemId];
    if (!def || def.category === 'food') return [];
    const max = maxCount(def);
    const fill = max ? (i.count ?? max) / max : 1;
    const price = i.issued || i.quest || isStash(i.container) ? 0 : sellPrice(i.itemId, fill);
    return [{ i, def, max, price }];
  }).sort((a, b) => Number(b.price > 0) - Number(a.price > 0));
  return (
    <section className="inv-box inv-shop">
      <header>
        <span>{t('shop.title')}</span>
        <Coins n={coins} />
      </header>
      <div className="shop-modes">
        <button className={mode === 'buy' ? 'on' : ''} onClick={() => setMode('buy')}>{t('shop.buy')}</button>
        <button className={mode === 'sell' ? 'on' : ''} onClick={() => setMode('sell')}>{t('shop.sell')}</button>
      </div>
      {mode === 'buy' ? (
        <>
          <div className="shop-tabs">
            {SHOP_TABS.map((c) => (
              <button key={c} className={tab === c ? 'on' : ''} onClick={() => setTab(c)}>{t(`shop.cat.${c}`)}</button>
            ))}
          </div>
          <div className="shop-list">
            {SHOP_STOCK.filter((e) => e.category === tab && (e.vendor ?? 'weapons') === 'weapons' && ITEMS[e.item]?.category !== 'food').map((e) => {
              const def = ITEMS[e.item];
              if (!def) return null;
              const afford = coins >= e.price;
              return (
                <div key={e.item} className="shop-row" style={ARMOR_BY_ITEM.get(e.item) ? { borderLeft: `3px solid ${RARITY_COLOR[ARMOR_BY_ITEM.get(e.item)!.rarity]}` } : undefined} onMouseEnter={() => onTip({ def })} onMouseLeave={() => onTip(null)}>
                  <span className="shop-art" style={{ background: def.color }}>
                    <ItemArt def={def} />
                  </span>
                  <span className="shop-name">
                    {item(e.item)}
                    <small>{def.ammo ? t('inv.rds', { n: def.ammo.capacity }) : `${def.w}×${def.h}`}</small>
                  </span>
                  <Coins n={e.price} className={afford ? '' : 'short'} />
                  <button data-nosound className="btn shop-btn" disabled={!afford || busy(`buy:${e.item}`)} onMouseDown={(ev) => ev.stopPropagation()} onClick={() => store.onBuy?.(e.item)}>
                    {busy(`buy:${e.item}`) ? <Spinner /> : t('shop.buy')}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="shop-list">
          {saleItems.length === 0 && <div className="shop-empty">{t('shop.nothing')}</div>}
          {saleItems.map(({ i, def, max, price }) => {
            return (
              <div key={i.uid} className="shop-row" onMouseEnter={() => onTip({ def, count: i.count, issued: i.issued })} onMouseLeave={() => onTip(null)}>
                <span className="shop-art" style={{ background: def.color }}>
                  <ItemArt def={def} />
                </span>
                <span className="shop-name">
                  {item(i.itemId)}
                  <small>{i.issued ? t('tip.issued') : max ? `${i.count ?? max}/${max}` : t(`cat.${def.category}`)}</small>
                </span>
                <Coins n={price} />
                <button data-nosound className="btn shop-btn" disabled={price <= 0 || busy(`sell:${i.uid}`)} onMouseDown={(ev) => ev.stopPropagation()} onClick={() => store.onSell?.(i.uid)}>
                  {busy(`sell:${i.uid}`) ? <Spinner /> : t('shop.sell')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Durability colour: green when new, through yellow, to red when nearly broken. */
export function durabilityColor(f: number): string {
  return `hsl(${Math.round(Math.max(0, Math.min(1, f)) * 120)}, 80%, 48%)`;
}

const ARMOR_HUD: Array<{ slot: 'head' | 'chest' | 'legs' | 'feet'; container: ContainerId }> = [
  { slot: 'head', container: 'armor_head' },
  { slot: 'chest', container: 'armor_chest' },
  { slot: 'legs', container: 'armor_legs' },
  { slot: 'feet', container: 'armor_feet' },
];

/** Worn armour beside the health bar: four small slots with each piece's durability. */
export function ArmorHud({ state }: { state: InventoryState }) {
  const { item, t } = useSettings();
  return (
    <div className="armor-hud">
      {ARMOR_HUD.map(({ slot, container }) => {
        const it = state.items.find((i) => i.container === container);
        const def = it ? ITEMS[it.itemId] : undefined;
        const max = def?.armor?.durability ?? 1;
        const f = it ? (it.count ?? max) / max : 0;
        return (
          <div key={slot} className={`armor-hud-slot ${def ? '' : 'empty'} ${def && f <= 0 ? 'broken' : ''}`} title={def ? `${item(def.id)} · ${Math.ceil(it!.count ?? max)}/${max}` : t(`cont.armor_${slot}`)}>
            {def ? <ItemArt def={def} /> : <span className="armor-hud-ph"><Icon name={slot === 'head' ? 'game-icons:helmet' : slot === 'chest' ? 'game-icons:armor-vest' : slot === 'legs' ? 'game-icons:trousers' : 'game-icons:boots'} /></span>}
            {def && (
              <div className="inv-dur">
                <div style={{ width: `${Math.max(0, f) * 100}%`, background: durabilityColor(f) }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const HB_CELL = 26;

/**
 * Weapon display (bottom-right): the weapon slots laid out on the same grid as the inventory,
 * showing only the models and counts. Number keys / mouse wheel select.
 */
export function Hotbar({ state, ammo, onSelect, touchVisible }: { state: InventoryState; ammo: { mag: number; max: number; reserve: number; reload: number | null } | null; onSelect?: (slot: number) => void; touchVisible?: boolean }) {
  const { t, item, touchControls } = useSettings();
  const bar = hotbar(state.items);
  if (!bar.length) return null;
  if (touchControls) {
    if (!touchVisible) return null;
    return <div className="touch-hotbar" role="group" aria-label={t('touch.weapon')}>
      {bar.map((entry, slot) => {
        const def = ITEMS[entry.itemId];
        if (!def) return null;
        const active = entry.uid === state.equipped;
        return <button key={entry.uid} type="button" className="touch-weapon-slot" aria-label={item(def.id)} aria-pressed={active}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (e.pointerType !== 'mouse' || e.button === 0) onSelect?.(slot); }}
          onClick={(e) => { if (e.detail === 0) onSelect?.(slot); }}>
          <ItemArt def={def} />
          <span>{item(def.id)}</span>
          {active && ammo && <small>{ammo.reload !== null ? t('inv.reloading') : `${ammo.mag}/${ammo.max} · ${ammo.reserve}`}</small>}
        </button>;
      })}
    </div>;
  }
  const keyOf = new Map(bar.slice(0, 9).map((b, n) => [b.uid, n + 1]));
  const grenadeCount = state.items.filter((o) => o.container === 'grenades').length;

  const renderBox = (id: ContainerId) => {
    const c = CONTAINERS[id];
    const items = state.items.filter((i) => i.container === id);
    if (!items.length) return null;
    return (
      <div key={id} className="hb-box" style={{ width: c.cols * HB_CELL, height: c.rows * HB_CELL }}>
        {items.map((i) => {
          const def = ITEMS[i.itemId]!;
          const f = footprint(def, i.rotated);
          const active = state.equipped === i.uid;
          return (
            <div
              key={i.uid}
              className={`hb-item ${active ? 'active' : ''}`}
              style={{ left: i.x * HB_CELL, top: i.y * HB_CELL, width: f.w * HB_CELL, height: f.h * HB_CELL }}
              title={item(def.id)}
            >
              <ItemArt def={def} />
              <span className="hb-key">{keyOf.get(i.uid)}</span>
              {active && ammo && (
                <span className="hb-count">
                  {ammo.reload != null ? t('inv.reloading') : `${ammo.mag}/${ammo.max} · ${ammo.reserve}`}
                </span>
              )}
              {active && ammo?.reload != null && <div className="hb-reload" style={{ transform: `scaleX(${ammo.reload})` }} />}
            </div>
          );
        })}
        {id === 'grenades' && <span className="hb-count hb-grenades">×{grenadeCount}</span>}
      </div>
    );
  };

  return (
    <div className="hotbar">
      {renderBox('heavy')}
      {renderBox('primary')}
      <div className="hb-row">
        {renderBox('secondary')}
        {renderBox('grenades')}
      </div>
    </div>
  );
}

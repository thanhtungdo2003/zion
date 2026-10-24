'use client';
import { Icon } from './Icon';
import { GroundPanel, type GroundEntry } from './GroundPanel';
import { ChestPanel } from './ChestPanel';
import { BlueprintPanel, SupplyPanel } from './BuildPanels';
import ModelPreview from './ModelPreview';

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react';
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
import { itemIconFor, itemIconVersion, itemIcons, subscribeItemIcons } from '@/game/inventory/icons';
import { usePending } from '@/game/pending';
import { Spinner } from './Spinner';
import { AttachmentPanel } from './AttachmentPanel';
import { AttachGuide } from './WeaponGuides';
import { ATTACHMENTS, acceptsAttachments, compatibleSlot, gunsFor, WEAPON_ATTACHMENTS, ARMOR_BY_ITEM, ARMOR_SLOTS, NURSE_HEAL_PRICE, NURSE_NAME, SHOP_STOCK, WEAPON_BY_ITEM, WEAPON_SPECS, weaponSpec, weaponSpeedFactor, weaponStaminaFactor, armorProtection, armorSpeedFactor, armorVision, armorHearing, buyPrice, sellPrice, isStash, type Attachments, type ShopCategory, type WeaponId, type ArmorSlot, ARMOR_BY_ID } from '@zion/shared';
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

/**
 * The full-screen inventory is a bento of four trays of equal height, laid out in cells:
 *   1 · storage: pockets (8×5), backpack storage (8×4), grenades and the off hand (1 row);
 *   2 · weapons: heavy, primary, the backpack's rifle slot and the sidearm, each filling its share;
 *   3 · the character (9 cells wide), or the worn gear beside a station;
 *   4 · worn gear (2 × 4 slots, the backpack two tall), or the station.
 * Column 1 sets the height (10 rows under 3 headers); every other tray stretches to it.
 */
export const BENTO = { gap: 8, boxY: 38, boxX: 18 };
function fitCell(): number {
  if (typeof window === 'undefined') return 48;
  const { gap, boxY, boxX } = BENTO;
  const w = (window.innerWidth - 64 - 3 * boxX - 1.5 * boxY - 3.5 * gap) / 30;
  const h = (window.innerHeight - 110 - 3 * boxY - 2 * gap) / 10;
  return Math.max(24, Math.min(80, Math.floor(Math.min(w, h))));
}
/** Height of the bento (column 1) and the worn-gear tray's width (square slots in 2 columns). */
function bentoSize(cell: number) {
  const { gap, boxY } = BENTO, height = 10 * cell + 3 * boxY + 2 * gap, row = (height - 3 * gap) / 4;
  return { height, wornWidth: 2 * row + gap };
}

/** Hover info: the item definition plus its per-item metadata. */
export type Tip = { def: ItemDef; count?: number; equipped?: boolean; issued?: boolean; /** The hovered item (Q throws it out); `chest`: it is in the open chest. */ uid?: number; chest?: boolean };

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
  if (spec) rows.push([L('tip.weight'), `${spec.weight} kg`]);
  if (spec?.kind === 'melee' && spec.decapitationChance) rows.push([L('tip.decapitation'), `${Math.round(spec.decapitationChance * 100)}%`]);
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
  const price = hidePrices ? null : buyPrice(def.id);
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
export function ItemArt({ def, attachments }: { def: ItemDef; attachments?: Attachments }) {
  const { item } = useSettings();
  // Re-render when icons (including a gun's dressed icon) finish rendering.
  useSyncExternalStore(subscribeItemIcons, itemIconVersion, () => 0);
  const src = itemIconFor(def.id, attachments);
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

function ItemTile({ def, rotated, count, style, className, attachments }: { def: ItemDef; rotated: boolean; count?: number; style?: React.CSSProperties; className?: string; attachments?: Attachments }) {
  const { w, h } = footprint(def, rotated);
  const { item } = useSettings();
  return (
    <div className={`inv-item ${className ?? ''}`} style={{ width: w * CELL - 4, height: h * CELL - 4, background: def.color, ...style }}>
      <div
        className="inv-item-art"
        style={{ position: 'absolute', left: '50%', top: '50%', width: def.w * CELL - 4, height: def.h * CELL - 4, transform: `translate(-50%, -50%) rotate(${rotated ? 90 : 0}deg)` }}
      >
        <ItemArt def={def} attachments={attachments} />
      </div>
      {w * h >= 4 && <span className="inv-item-name">{item(def.id)}</span>}
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
  /** A one-piece slot that fills its tray: the cells sit centred in it. */
  fill?: boolean;
}

function Grid({ id, state, store, hover, onHover, grab, onGrab, lastDown, onTip, fill = false }: GridProps) {
  const cells = useRef<HTMLDivElement>(null);
  const { t } = useSettings();
  const c = CONTAINERS[id];
  const held = state.held;
  const items = state.items.filter((i) => i.container === id);
  const heldDef = held ? ITEMS[held.itemId]! : null;
  const fp = heldDef ? footprint(heldDef, held!.rotated) : { w: 1, h: 1 };

  // Anchor the held item on the cell it was grabbed by (clamped after a rotation).
  const anchorOf = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = (cells.current ?? e.currentTarget).getBoundingClientRect();
    const cell = r.width / c.cols;
    // A filling slot takes a press anywhere in its tray as the nearest cell.
    const clampX = (v: number) => (fill ? Math.max(0, Math.min(c.cols - 1, v)) : v), clampY = (v: number) => (fill ? Math.max(0, Math.min(c.rows - 1, v)) : v);
    const cx = clampX(Math.floor((e.clientX - r.left) / cell));
    const cy = clampY(Math.floor((e.clientY - r.top) / cell));
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
    <section className={`inv-box inv-${id} ${dim ? 'inv-dim' : ''}${fill ? ' inv-fill' : ''}`}>
      <header>
        <span>{t(`cont.${id}`)}</span>
        <small>{accepted}</small>
        {(id === 'backpack' || isStash(id)) && (
          <button type="button" className="inv-sort" aria-label="Tự động sắp xếp" title="Tự động sắp xếp"
            disabled={!!held || !items.length} onMouseDown={(e) => e.stopPropagation()} onClick={() => store.sortContainer(id)}>
            <Icon name="lucide:arrow-down-wide-narrow" />
          </button>
        )}
      </header>
      <div
        className={fill ? 'inv-fill-area' : 'inv-grid'}
        ref={fill ? undefined : cells}
        style={fill ? undefined : { width: c.cols * CELL, height: c.rows * CELL, backgroundSize: `${CELL}px ${CELL}px` }}
        onMouseMove={(e) => {
          const { x, y } = anchorOf(e);
          if (hover?.container !== id || hover.x !== x || hover.y !== y) onHover({ container: id, x, y });
          if (held) return onTip(null);
          const { cx, cy } = anchorOf(e);
          const under = items.find((i) => {
            const f = footprint(ITEMS[i.itemId]!, i.rotated);
            return cx >= i.x && cx < i.x + f.w && cy >= i.y && cy < i.y + f.h;
          });
          onTip(under ? { def: ITEMS[under.itemId]!, count: under.count, equipped: state.equipped === under.uid, issued: under.issued, uid: under.uid } : null);
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
          // Right-click rotates melee weapons, uses first aid, or eats food.
          e.preventDefault();
          e.stopPropagation();
          if (held) {
            if (ITEMS[held.itemId]?.category === 'melee') store.rotateHeld();
            return;
          }
          const { cx, cy } = anchorOf(e);
          const under = items.find((i) => {
            const f = footprint(ITEMS[i.itemId]!, i.rotated);
            return cx >= i.x && cx < i.x + f.w && cy >= i.y && cy < i.y + f.h;
          });
          // Started first aid: close the inventory so the bandaging can be seen.
          // Guns that take attachments open their attachment screen.
          if (under && store.onUseItem?.(under.uid)) return;
          if (under && acceptsAttachments(under.itemId)) store.openAttachments(under.uid);
          else if (under && ITEMS[under.itemId]?.category === 'melee') store.rotateItem(under.uid);
          else if (under?.itemId === 'medkit' && store.onUseMedkit?.(under.uid)) store.setOpen(false);
          else if (under?.itemId === 'coal_carton' && store.onUseCoal?.(under.uid)) store.setOpen(false);
          else if (under) store.onEat?.(under.uid);
        }}
      >
        <GridCells fill={fill} cellsRef={cells} cols={c.cols} rows={c.rows}>
        {items.map((i: PlacedItem) => (
          <ItemTile
            key={i.uid}
            def={ITEMS[i.itemId]!}
            rotated={i.rotated}
            count={i.count}
            attachments={i.attachments}
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
        </GridCells>
      </div>
    </section>
  );
}

/** The cells of a filling slot, centred in its tray (a plain grid renders its children as they are). */
function GridCells({ fill, cellsRef, cols, rows, children }: { fill: boolean; cellsRef: React.RefObject<HTMLDivElement | null>; cols: number; rows: number; children: React.ReactNode }) {
  // Shrunk to fit when the tray is smaller than the slot's cells (the backpack's 3×3 in a 2-wide column).
  const [k, setK] = useState(1);
  useEffect(() => {
    const area = cellsRef.current?.parentElement;
    if (!fill || !area) return;
    const fit = () => setK(Math.min(1, (area.clientWidth - 6) / (cols * CELL), (area.clientHeight - 6) / (rows * CELL)));
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    fit();
    return () => ro.disconnect();
  }, [fill, cellsRef, cols, rows]);
  if (!fill) return <>{children}</>;
  return <div ref={cellsRef} className="inv-grid" style={{ width: cols * CELL, height: rows * CELL, backgroundSize: `${CELL}px ${CELL}px`, transform: k < 1 ? `scale(${k})` : undefined }}>{children}</div>;
}

/** Bento inventory panel (E). Drag & drop to move, R rotates while dragging, double-click quick-moves. */
/** Battle royale has no economy: prices and ZCoin stay hidden there. */
let hidePrices = false;
export function InventoryPanel({ state, store, coins: shownCoins, side, ground = [], onPickGround }: { state: InventoryState; store: InventoryStore; coins: number | null; side?: React.ReactNode; ground?: readonly GroundEntry[]; onPickGround?: (id: number) => void }) {
  hidePrices = shownCoins === null;
  const coins = shownCoins ?? 0;
  const wrap = useRef<HTMLDivElement>(null);
  const [panelScale, setPanelScale] = useState(1);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const resize = () => {
      const viewport = el.closest('.inv-overlay')!;
      setPanelScale(el.classList.contains('inv-full') ? 1 : Math.min(1, viewport.clientWidth * .96 / Math.max(1, el.scrollWidth), viewport.clientHeight * .94 / Math.max(1, el.scrollHeight)));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    observer.observe(el.closest('.inv-overlay')!);
    resize();
    return () => observer.disconnect();
  }, []);
  const [merchantTab, setMerchantTab] = useState<'shop' | 'bag'>('shop');
  useEffect(() => { if (!state.open || state.station !== 'shop') setMerchantTab('shop'); }, [state.open, state.station]);
  const busy = usePending();
  const { t, item, touchControls } = useSettings();
  const [mouse, setMouse] = useState({ x: -999, y: -999 });
  const [hover, setHover] = useState<{ container: ContainerId; x: number; y: number } | null>(null);
  const [grab, setGrab] = useState<Grab>({ dx: 0, dy: 0 });
  const lastDown = useRef<{ uid: number; t: number } | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const hoveredRef = useRef<Tip | null>(null);
  hoveredRef.current = tip;
  const [, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  CELL = fitCell();
  const bento = bentoSize(CELL);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyR') store.rotateHeld();
      // Q: throw the hovered item out onto the ground (from the bag, the backpack or the open chest).
      else if (e.code === 'KeyQ' && !state.held && hoveredRef.current?.uid !== undefined) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const h = hoveredRef.current;
        if (h.chest) store.chestDrop(h.uid!); else store.throwItem(h.uid!);
        setTip(null);
      }
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
      // Released over a grid, slot or panel control: put back (the grid itself places it).
      // Anywhere else — the empty space around the trays included — it is thrown out.
      const onTray = e.target instanceof Element && e.target.closest('.inv-box, .inv-title, .chest-panel, .merchant-panel, button, input, .inv-model-view');
      if (onTray) store.returnHeld();
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
  const grid = (id: ContainerId, fill = false) => <Grid id={id} state={state} store={store} hover={hover} onHover={setHover} grab={grab} onGrab={setGrab} lastDown={lastDown} onTip={setTip} fill={fill} />;
  const packWorn = state.items.some((i) => i.container === 'pack');
  // A chest or a station takes the fourth column; the armour then moves into the third.
  const sideStation = !!state.station && state.station !== 'shop';

  // The attachment screen replaces the inventory: the gun alone on screen, its slots around it.
  if (state.attachGun != null) return <AttachmentPanel state={state} store={store} />;

  return (
    <div className="inv-overlay" onContextMenu={(e) => {
      e.preventDefault();
      if (state.held && ITEMS[state.held.itemId]?.category === 'melee') store.rotateHeld();
    }}>
      <div ref={wrap} className={`inv-wrap${state.station === 'shop' && merchantTab === 'shop' ? ' merchant-wrap' : ' inv-full'}`} style={state.station === 'shop' && merchantTab === 'shop' ? { transform: `translate(-50%, -50%) scale(${panelScale})` } : undefined}>
      {state.station !== 'shop' && state.items.some((i) => ITEMS[i.itemId]?.category === 'attachment') && state.items.some((i) => acceptsAttachments(i.itemId)) && <div className="inv-attach-hint"><AttachGuide /></div>}
      {state.station !== 'shop' && side}
      <div className={`inv-panel${state.station === 'shop' ? ' merchant-panel' : ''}`}>
        <div className="inv-title">
          <h2>{t(state.station === 'shop' ? 'shop.title' : 'inv.title')}</h2>
          {!hidePrices && <Coins n={coins} />}
          <button type="button" className="inv-close" aria-label={t('inv.close')} onClick={() => store.setOpen(false)}><Icon name="lucide:x" /></button>
          {touchControls && state.held && <div className="inv-touch-actions" onMouseUp={(e) => e.stopPropagation()}>
            <button type="button" className="inv-close" aria-label={t('inv.rotate')} onClick={() => store.rotateHeld()}><Icon name="lucide:rotate-cw" /></button>
            <button type="button" className="inv-close" aria-label={t('inv.swap')} onClick={() => { const uid = state.held!.uid; store.returnHeld(); store.quickMove(uid); }}><Icon name="lucide:arrow-left-right" /></button>
            {heldDef?.id === 'coal_carton' && <button type="button" className="inv-close" aria-label={heldDef.info} onClick={() => { const uid = state.held!.uid; store.returnHeld(); if (store.onUseCoal?.(uid)) store.setOpen(false); }}><Icon name="lucide:flame" /></button>}
            {heldDef?.category === 'food'  && <button type="button" className="inv-close" aria-label={t('inv.use')} onClick={() => { const uid = state.held!.uid; store.returnHeld(); if (store.onEat?.(uid)) store.setOpen(false); }}><Icon name="lucide:utensils" /></button>}
            <button type="button" className="inv-close" aria-label={t('inv.close')} onClick={() => store.returnHeld()}><Icon name="lucide:undo-2" /></button>
          </div>}
          {process.env.NODE_ENV !== 'production' && !hidePrices && (
            <button className="btn inv-dev-coins" title={t('inv.dev_coins')} onClick={() => store.onDevCoins?.()}>
              +
            </button>
          )}
          <div className="keys" hidden={state.station === 'shop' && merchantTab === 'shop'}>
            <kbd>{t('inv.drag')}</kbd> {t('inv.move')} · <kbd>R</kbd> {t('inv.rotate')} · <kbd>{t('inv.dblclick')}</kbd> {t('inv.swap')} · {t('inv.drop_hint')} · {t('inv.use')} ·{' '}
            {t('inv.rotate_melee')} · <kbd>E</kbd> {t('inv.close')}
          </div>
        </div>
        {state.station === 'shop' && <nav className="merchant-tabs" aria-label="Cửa hàng và túi đồ">
          <button className={merchantTab === 'shop' ? 'on' : ''} aria-pressed={merchantTab === 'shop'} onClick={() => { store.returnHeld(); setTip(null); setMerchantTab('shop'); }}><Icon name="lucide:store" />{t('shop.title')}</button>
          <button className={merchantTab === 'bag' ? 'on' : ''} aria-pressed={merchantTab === 'bag'} onClick={() => { setTip(null); setMerchantTab('bag'); }}><Icon name="lucide:backpack" />{t('inv.title')}</button>
        </nav>}
        {state.station === 'shop' && merchantTab === 'shop' ? <ShopPanel state={state} store={store} coins={coins} /> :
        <div className="inv-quad" style={{ height: bento.height, gap: BENTO.gap }}>
          {/* 1 · What is carried: the pockets, the backpack's storage while one is worn, grenades and the off hand. */}
          <div className="inv-col inv-q1" style={{ width: 8 * CELL + BENTO.boxX }}>
            {grid('backpack')}
            {packWorn ? grid('pack_storage') : <PackHint cols={8} rows={4} />}
            <div className="inv-row">
              {grid('grenades')}
              {grid('offhand', true)}
            </div>
          </div>
          {/* 2 · Weapon slots (the backpack adds a rifle slot), each filling its share of the tray. */}
          <div className="inv-col inv-q2" style={{ width: 8 * CELL + BENTO.boxX }}>
            {grid('heavy', true)}
            {grid('primary', true)}
            {packWorn ? grid('pack_rifle', true) : <PackHint cols={6} rows={2} rifle />}
            {grid('secondary', true)}
          </div>
          {/* 3 · The character as equipped, or (beside a chest/station) the worn gear. */}
          {sideStation ? <div className="inv-col inv-q3" style={{ width: bento.wornWidth }}><WornGear grid={grid} /></div>
            : <div className="inv-col inv-q3" style={{ width: 9 * CELL + BENTO.boxX }}><ModelView state={state} store={store} /></div>}
          {/* 4 · Worn gear, or the open chest / station. */}
          {!sideStation && <div className="inv-col inv-q4" style={{ width: bento.wornWidth }}><WornGear grid={grid} /></div>}
          {sideStation && <div className="inv-col inv-q4">
          {state.station === 'stash' && <StashPanel grid={grid} items={state.items} />}
          {state.station === 'nurse' && <NursePanel store={store} coins={coins} onTip={setTip} />}
          {state.station === 'architect' && <BlueprintPanel state={state} store={store} />}
          {state.station === 'supply' && <SupplyPanel coins={coins} store={store} />}
          {state.station === 'chest' && <div className="inv-col"><ChestPanel state={state} store={store} grid={hidePrices} onTip={setTip} />{onPickGround && <GroundPanel items={ground} onPick={onPickGround} inChest onTip={setTip} />}</div>}
          {(state.station === 'field' || state.station === 'camp') && (
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
          </div>}
        </div>}
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
            left: mouse.x - (Math.min(grab.dx, fp.w - 1) + 0.5) * CELL * panelScale,
            top: mouse.y - (Math.min(grab.dy, fp.h - 1) + 0.5) * CELL * panelScale,
            transform: `scale(${panelScale})`, transformOrigin: 'top left',
          }}
        />
      )}
    </div>
  );
}

/** Where the backpack's grids appear once one is worn: an empty frame of their size. */
function PackHint({ cols, rows, rifle = false }: { cols: number; rows: number; rifle?: boolean }) {
  const { t } = useSettings();
  return (
    <section className="inv-box inv-pack-hint" style={{ width: cols * CELL + 2 }}>
      <header><span>{t(rifle ? 'cont.pack_rifle' : 'cont.pack_storage')}</span></header>
      <div className="inv-pack-hint-body" style={{ height: rows * CELL }}><Icon name="lucide:backpack" /><span>{t('inv.pack_hint')}</span></div>
    </section>
  );
}

/** The armour set's totals: protection, weight and walking speed. */
function GearStats({ store }: { store: InventoryStore }) {
  const { t } = useSettings();
  const worn = store.wornArmor();
  let kg = 0;
  for (const s of ARMOR_SLOTS) kg += ARMOR_BY_ID.get(worn[s])?.weight ?? 0;
  const vision = armorVision(worn), hearing = armorHearing(worn);
  return (
    <small className="inv-equip-stats">
      <Icon name="game-icons:shield" /> <b>−{Math.round(armorProtection(worn) * 100)}%</b> · <Icon name="lucide:weight" /> <b>{kg.toFixed(1)} kg</b> · {t('inv.speed')} <b>{Math.round(armorSpeedFactor(worn) * 100)}%</b>
      {vision > 0 && <> · <Icon name="lucide:eye" /> <b>−{Math.round(vision * 100)}%</b></>}
      {Math.abs(hearing - 1) > .01 && <> · <Icon name="lucide:ear" /> <b>{Math.round(hearing * 100)}%</b></>}
    </small>
  );
}

/** The character as equipped (armour, backpack, the weapon in hand and those it carries), large. */
function ModelView({ state, store }: { state: InventoryState; store: InventoryStore }) {
  const { t } = useSettings();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !store.preview) return;
    return store.preview.mount(host.current);
  }, [store]);
  void state;
  return (
    <section className="inv-box inv-model">
      <header><span>{t('inv.equipment')}</span><GearStats store={store} /></header>
      <div className="inv-model-view" ref={host} />
    </section>
  );
}

/**
 * Worn gear as a bento of square slots, two columns by four rows filling the tray:
 *   helmet | ears · body armour | face · trousers | backpack (two rows) · boots.
 */
function WornGear({ grid }: { grid: (id: ContainerId, fill?: boolean) => React.ReactNode }) {
  return (
    <div className="inv-worn-bento">
      <div style={{ gridArea: 'head' }}>{grid('armor_head', true)}</div>
      <div style={{ gridArea: 'ears' }}>{grid('armor_ears', true)}</div>
      <div style={{ gridArea: 'chest' }}>{grid('armor_chest', true)}</div>
      <div style={{ gridArea: 'face' }}>{grid('armor_face', true)}</div>
      <div style={{ gridArea: 'legs' }}>{grid('armor_legs', true)}</div>
      <div style={{ gridArea: 'pack' }}>{grid('pack', true)}</div>
      <div style={{ gridArea: 'feet' }}>{grid('armor_feet', true)}</div>
    </div>
  );
}

const SHOP_TABS: ShopCategory[] = ['guns', 'heavy', 'melee', 'explosives', 'ammo', 'attachments', 'armor', 'tools'];

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
function ShopPanel({ state, store, coins }: { state: InventoryState; store: InventoryStore; coins: number }) {
  const busy = usePending();
  const tr = useSettings(), { t, item } = tr;
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [tab, setTab] = useState<ShopCategory>('guns');
  const [selected, setSelected] = useState<string | number>('');
  /** Attachments tab narrowed to one gun ("View attachments" on a gun listing). */
  const [fitFor, setFitFor] = useState<string | null>(null);
  const fitting = fitFor ? new Set(Object.values(WEAPON_ATTACHMENTS[fitFor] ?? {}).flat()) : null;
  const products = mode === 'buy'
    ? SHOP_STOCK.filter(e => e.category === tab && (e.vendor ?? 'weapons') === 'weapons' && ITEMS[e.item]?.category !== 'food' && (tab !== 'attachments' || !fitting || fitting.has(e.item)))
      .map(e => ({ key: e.item, id: e.item, price: e.price, count: undefined as number | undefined, issued: false }))
    : state.items.flatMap(i => {
      const def = ITEMS[i.itemId];
      if (!def || def.category === 'food') return [];
      const max = maxCount(def), fill = max ? (i.count ?? max) / max : 1;
      return [{ key: i.uid, id: i.itemId, price: i.issued || i.quest || isStash(i.container) ? 0 : sellPrice(i.itemId, fill), count: i.count, issued: !!i.issued }];
    }).sort((a,b) => Number(b.price > 0) - Number(a.price > 0));
  const selection = products.find(p => p.key === selected) ?? products[0];
  const def = selection ? ITEMS[selection.id] : undefined;
  const spec = selection ? weaponSpec(WEAPON_BY_ITEM[selection.id] ?? 0) : undefined;
  const gun = spec?.kind === 'gun' ? spec : undefined;
  const ammo = def ? Object.values(ITEMS).filter(d => d.ammo?.guns.includes(def.id)) : [];
  // Attachments are previewed mounted: on a compatible gun the player carries, else on the first gun that takes it.
  const mountedOn = def?.category === 'attachment' ? (() => {
    const own = [state.items.find(i => i.uid === state.equipped), ...state.items].find(i => i && compatibleSlot(i.itemId, def.id));
    if (own) return { itemId: own.itemId, attachments: own.attachments, owned: true };
    const sample = gunsFor(def.id)[0];
    return sample ? { itemId: sample, attachments: undefined, owned: false } : null;
  })() : null;
  return <section className="merchant-shop">
    <header className="merchant-shop-head"><div className="shop-modes">
      <button className={mode === 'buy' ? 'on' : ''} onClick={() => { setMode('buy'); setSelected(''); }}>{t('shop.buy')}</button>
      <button className={mode === 'sell' ? 'on' : ''} onClick={() => { setMode('sell'); setSelected(''); }}>{t('shop.sell')}</button>
    </div><Coins n={coins} /></header>
    {mode === 'buy' && <div className="shop-tabs">{SHOP_TABS.map(c => <button key={c} className={tab === c ? 'on' : ''} onClick={() => { setTab(c); setSelected(''); setFitFor(null); }}>{t(`shop.cat.${c}`)}</button>)}{tab === 'attachments' && <div className="shop-attach-guide"><AttachGuide /></div>}</div>}
    {mode === 'buy' && tab === 'attachments' && fitFor && <div className="shop-fit-filter"><Icon name="lucide:filter" /> Phụ kiện lắp được cho <b>{item(fitFor)}</b><button type="button" aria-label="Bỏ lọc" onClick={() => setFitFor(null)}><Icon name="lucide:x" /></button></div>}
    <div className="shop-browser"><div className="shop-catalog">
      {!products.length && <div className="shop-empty">{t('shop.nothing')}</div>}
      {products.map(p => {
        const d = ITEMS[p.id]!;
        const pending = busy(`${mode}:${p.key}`), enabled = mode === 'buy' ? coins >= p.price : p.price > 0;
        return <article className={`shop-card${selection?.key === p.key ? ' selected' : ''}`} key={p.key}>
          <button className="shop-card-select" aria-pressed={selection?.key === p.key} onClick={() => setSelected(p.key)}>
            <span className="shop-card-art" style={{ background: d.color }}><ItemArt def={d} /></span>
            <b>{item(p.id)}</b><small>{p.issued ? t('tip.issued') : maxCount(d) ? `${p.count ?? maxCount(d)}/${maxCount(d)}` : `${d.w}×${d.h}`}</small>
          </button>
          <div className="shop-card-action"><Coins n={p.price} className={enabled ? '' : 'short'} /><button className="btn shop-btn" data-nosound disabled={!enabled || pending} onClick={() => mode === 'buy' ? store.onBuy?.(p.id) : typeof p.key === 'number' && store.onSell?.(p.key)}>{pending ? <Spinner /> : t(mode === 'buy' ? 'shop.buy' : 'shop.sell')}</button></div>
        </article>;
      })}
    </div>{def && <aside className="shop-detail">
      <h3>{item(def.id)}</h3>
      {gun ? <ModelPreview key={def.id} model={{ item: def.id }} title={item(def.id)} />
        : def.category === 'attachment' && mountedOn ? <><ModelPreview key={`${def.id}@${mountedOn.itemId}`} model={{ item: mountedOn.itemId }} attachments={{ ...mountedOn.attachments, [ATTACHMENTS[def.id]!.slot]: def.id }} title={item(def.id)} /><p className="shop-mount-note">Xem trước trên {mountedOn.owned ? 'khẩu' : 'mẫu'} <b>{item(mountedOn.itemId)}</b>{mountedOn.owned ? ' của bạn' : ''}</p></>
        : <div className="shop-detail-art"><ItemArt def={def} /></div>}
      <p>{itemInfo(tr, def)}</p>
      {def.category === 'attachment' && <><h4>Lắp được cho</h4><div className="shop-compatible">{gunsFor(def.id).map(g => <button key={g} onClick={() => { setMode('buy'); setTab(SHOP_STOCK.find(e => e.item === g)?.category ?? 'guns'); setSelected(g); setFitFor(null); }}><span className="shop-ammo-art"><ItemArt def={ITEMS[g]!} /></span><span>{item(g)}</span><Icon name="lucide:arrow-right" /></button>)}</div></>}
      {spec && <dl className="shop-stats"><div><dt>{t('tip.weight')}</dt><dd>{spec.weight} kg</dd></div><div><dt>Tốc độ khi cầm</dt><dd>{Math.round(weaponSpeedFactor(WEAPON_BY_ITEM[def.id] ?? 0) * 100)}%</dd></div><div><dt>Hao thể lực vũ khí</dt><dd>+{Math.round((weaponStaminaFactor(WEAPON_BY_ITEM[def.id] ?? 0) - 1) * 100)}%</dd></div>{spec.kind === 'melee' && !!spec.decapitationChance && <div><dt>{t('tip.decapitation')}</dt><dd>{Math.round(spec.decapitationChance * 100)}%</dd></div>}{gun?.scope && <div><dt>Ống ngắm</dt><dd>{gun.scope}×</dd></div>}</dl>}
      {gun && <><dl className="shop-stats"><div><dt>Sát thương</dt><dd>{gun.damage}{gun.pellets > 1 ? ` × ${gun.pellets}` : ''}</dd></div><div><dt>Băng đạn</dt><dd>{gun.magazine} viên</dd></div><div><dt>Tầm bắn</dt><dd>{gun.range} m</dd></div><div><dt>Nạp đạn</dt><dd>{gun.reloadMs / 1000} s</dd></div></dl>
        {WEAPON_ATTACHMENTS[def.id] && <button type="button" className="btn shop-view-attachments" onClick={() => { setMode('buy'); setTab('attachments'); setFitFor(def.id); setSelected(''); }}><Icon name="lucide:scan-eye" /> Xem phụ kiện lắp được</button>}
        <h4>Đạn tương thích</h4><div className="shop-compatible">{ammo.map(d => <button key={d.id} onClick={() => { setMode('buy'); setTab('ammo'); setSelected(d.id); }}><span className="shop-ammo-art"><ItemArt def={d} /></span><span>{item(d.id)}<small>{d.ammo!.capacity} viên / hộp</small></span><Icon name="lucide:arrow-right" /></button>)}{!ammo.length && <p>Chưa có hộp đạn tương thích.</p>}</div>
      </>}
    </aside>}</div>
  </section>;
}

/** Durability colour: green when new, through yellow, to red when nearly broken. */
export function durabilityColor(f: number): string {
  return `hsl(${Math.round(Math.max(0, Math.min(1, f)) * 120)}, 80%, 48%)`;
}

const ARMOR_HUD: Array<{ slot: ArmorSlot; container: ContainerId; icon: string }> = [
  { slot: 'head', container: 'armor_head', icon: 'game-icons:helmet' },
  { slot: 'face', container: 'armor_face', icon: 'game-icons:gas-mask' },
  { slot: 'ears', container: 'armor_ears', icon: 'game-icons:headphones' },
  { slot: 'chest', container: 'armor_chest', icon: 'game-icons:armor-vest' },
];

/** Worn armour beside the health bar: four small slots with each piece's durability. */
export function ArmorHud({ state }: { state: InventoryState }) {
  const { item, t } = useSettings();
  return (
    <div className="armor-hud">
      {ARMOR_HUD.map(({ slot, container, icon }) => {
        const it = state.items.find((i) => i.container === container);
        // Empty face / ear slots stay off the HUD (most players never wear them).
        if (!it && (slot === 'face' || slot === 'ears')) return null;
        const def = it ? ITEMS[it.itemId] : undefined;
        const max = def?.armor?.durability ?? 1;
        const f = it ? (it.count ?? max) / max : 0;
        return (
          <div key={slot} className={`armor-hud-slot ${def ? '' : 'empty'} ${def && f <= 0 ? 'broken' : ''}`} title={def ? `${item(def.id)} · ${Math.ceil(it!.count ?? max)}/${max}` : t(`cont.armor_${slot}`)}>
            {def ? <ItemArt def={def} /> : <span className="armor-hud-ph"><Icon name={icon} /></span>}
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
          <ItemArt def={def} attachments={entry.attachments} />
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
              <ItemArt def={def} attachments={i.attachments} />
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
      {state.items.some((i) => i.container === 'pack') && renderBox('pack_rifle')}
      <div className="hb-row">
        {renderBox('secondary')}
        {renderBox('grenades')}
      </div>
    </div>
  );
}

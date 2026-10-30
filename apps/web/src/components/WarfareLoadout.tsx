'use client';
import dynamic from 'next/dynamic';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ATTACHMENT_SLOTS, ITEMS, WARFARE_CLASSES, WARFARE_KITS, WEAPON_ATTACHMENTS, WEAPON_BY_ITEM, sanitizeWarfareLoadout, weaponSpec,
  type AttachmentSlot, type Attachments, type ClientMessage, type WarfareClass, type WarfareLoadout, type WarfareSide, type WarfareStateMessage,
} from '@zion/shared';
import { itemIconFor, itemIconVersion, subscribeItemIcons } from '@/game/inventory/icons';
import { Icon } from './Icon';

const ModelPreview = dynamic(() => import('./ModelPreview'), { ssr: false });

type WarfareMsg = ClientMessage & { t: 'wfDeploy' | 'wfSquad' | 'wfOrder' | 'wfRecruit' | 'wfEmote' };
const SIDE_COLOR: Record<WarfareSide, string> = { blue: '#4fa3ff', red: '#ff5a4a' };
const LOADOUT_KEY = 'zion.warfare.loadout';
const CLASS_ICON: Record<WarfareClass, string> = { assault: 'game-icons:ak47', medic: 'game-icons:health-normal', engineer: 'game-icons:spanner', support: 'game-icons:machine-gun', recon: 'game-icons:crosshair' };
type Slot = 'primary' | 'secondary' | 'heavy' | 'gadget';
const SLOT_NAME: Record<Slot, string> = { primary: 'Chính', secondary: 'Phụ', heavy: 'Hạng nặng', gadget: 'Chiến thuật' };
const OPTIC_NAME: Record<AttachmentSlot, string> = { optic: 'Ống ngắm', muzzle: 'Đầu nòng' };
const name = (id: string) => ITEMS[id]?.name ?? id;

interface Saved { cls: WarfareClass; loadout: Record<WarfareClass, WarfareLoadout> }
function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? 'null') as Saved | null;
    if (v && WARFARE_CLASSES.includes(v.cls)) return { cls: v.cls, loadout: { ...v.loadout } };
  } catch { /* storage blocked */ }
  return { cls: 'assault', loadout: {} as Record<WarfareClass, WarfareLoadout> };
}

/* ----------------------------------------------------------------------------- bento layout */

interface Cell { key: string; slot: Slot; item: string | null; weight: number }
interface Rect { x: number; y: number; w: number; h: number }

/**
 * Squarified treemap: the cells fill the rectangle exactly, each with an area in proportion to
 * its weight and as close to square as the set allows (a bento box).
 */
function squarify(cells: readonly Cell[], box: Rect): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const total = cells.reduce((s, c) => s + c.weight, 0) || 1;
  const items = [...cells].sort((a, b) => b.weight - a.weight).map((c) => ({ c, a: c.weight / total * box.w * box.h }));
  let r = { ...box };
  const worst = (row: typeof items, side: number) => {
    const sum = row.reduce((s, i) => s + i.a, 0), max = Math.max(...row.map((i) => i.a)), min = Math.min(...row.map((i) => i.a));
    return Math.max(side * side * max / (sum * sum), sum * sum / (side * side * min));
  };
  const lay = (row: typeof items) => {
    const sum = row.reduce((s, i) => s + i.a, 0);
    if (r.w >= r.h) {
      const w = sum / r.h; let y = r.y;
      for (const i of row) { const h = i.a / w; out.set(i.c.key, { x: r.x, y, w, h }); y += h; }
      r = { x: r.x + w, y: r.y, w: r.w - w, h: r.h };
    } else {
      const h = sum / r.w; let x = r.x;
      for (const i of row) { const w = i.a / h; out.set(i.c.key, { x, y: r.y, w, h }); x += w; }
      r = { x: r.x, y: r.y + h, w: r.w, h: r.h - h };
    }
  };
  let row: typeof items = [];
  for (const it of items) {
    const side = Math.min(r.w, r.h);
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else { lay(row); row = [it]; }
  }
  if (row.length) lay(row);
  return out;
}

/** How much of the box a weapon takes: its size in the inventory (gadgets get a usable minimum). */
function weightOf(slot: Slot, item: string | null): number {
  const d = item ? ITEMS[item] : undefined;
  if (slot === 'gadget') return 2.2;
  if (!d) return slot === 'secondary' ? 4 : 7;
  return Math.max(4, d.w * d.h);
}

/* ------------------------------------------------------------------------------ the screen */

/**
 * Before deploying: class tabs; the chosen weapons as a bento box (each cell sized by the weapon)
 * filling most of the screen; a click opens the weapon grid for that slot, a right click the gun's
 * sights and muzzle devices; deploy point chips and the deploy button along the bottom.
 */
export function WarfareLoadout({ state, elapsed, onSend, onLeave, squads }: { state: WarfareStateMessage; elapsed: number; onSend: (m: WarfareMsg) => void; onLeave: () => void; squads: React.ReactNode }) {
  const you = state.you!;
  useSyncExternalStore(subscribeItemIcons, itemIconVersion, () => 0);
  const [saved, setSaved] = useState<Saved>(() => loadSaved());
  const [spawn, setSpawn] = useState<string | null>(you.spawn);
  const [open, setOpen] = useState<Slot | null>(null);
  const [tuning, setTuning] = useState<string | null>(null);
  const cls = saved.cls, kit = WARFARE_KITS[cls];
  const choice = sanitizeWarfareLoadout(cls, saved.loadout[cls]);
  const save = (next: Saved) => { setSaved(next); try { localStorage.setItem(LOADOUT_KEY, JSON.stringify(next)); } catch { /* storage blocked */ } };
  const set = (patch: WarfareLoadout) => save({ ...saved, loadout: { ...saved.loadout, [cls]: { ...choice, ...patch } } });
  const setAttachment = (gun: string, slot: AttachmentSlot, id: string | null) => {
    const cur: Attachments = { ...(choice.attachments[gun] ?? saved.loadout[cls]?.attachments?.[gun] ?? {}) };
    if (id) cur[slot] = id; else delete cur[slot];
    set({ attachments: { ...(saved.loadout[cls]?.attachments ?? {}), ...choice.attachments, [gun]: cur } });
  };
  const wait = Math.max(0, (you.respawnIn ?? 0) - elapsed);
  useEffect(() => { if (spawn && !state.deploy.some((d) => d.id === spawn && d.safe)) setSpawn(null); }, [state.deploy, spawn]);
  // Esc closes the top layer (and never reaches the game).
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || (!open && !tuning)) return; e.preventDefault(); e.stopPropagation(); if (tuning) setTuning(null); else setOpen(null); };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, tuning]);
  const deploy = (ready: boolean) => onSend({ t: 'wfDeploy', cls, loadout: { ...choice }, ...(spawn ? { spawn } : {}), ready });

  const usesSecondary = !['smg', 'pistol'].includes(ITEMS[choice.primary]?.category ?? '') && kit.secondary.length > 0;
  const cells: Cell[] = [
    { key: 'primary', slot: 'primary', item: choice.primary, weight: weightOf('primary', choice.primary) },
    ...(kit.heavy.length ? [{ key: 'heavy', slot: 'heavy' as const, item: choice.heavy, weight: weightOf('heavy', choice.heavy) }] : []),
    ...(usesSecondary ? [{ key: 'secondary', slot: 'secondary' as const, item: choice.secondary, weight: weightOf('secondary', choice.secondary) }] : []),
    ...Array.from({ length: kit.maxGadgets }, (_, i) => ({ key: `gadget${i}`, slot: 'gadget' as const, item: choice.gadgets[i] ?? null, weight: weightOf('gadget', null) })),
  ];
  return (
    <div className="wfl" role="dialog" aria-label="Trang bị" style={{ '--side': SIDE_COLOR[you.side] } as React.CSSProperties}>
      <header className="wfl-top">
        <nav className="wfl-classes" aria-label="Binh chủng">
          {WARFARE_CLASSES.map((c) => <button key={c} type="button" className={c === cls ? 'on' : ''} title={WARFARE_KITS[c].role} onClick={() => { save({ ...saved, cls: c }); setOpen(null); }}><Icon name={CLASS_ICON[c]} /><span>{WARFARE_KITS[c].name}</span></button>)}
        </nav>
        <div className="wfl-status">
          <span title="Quân số dự bị"><Icon name="lucide:users" /><b>{state.tickets[you.side]}</b></span>
          {you.waiting ? <span className="warn" title={you.waiting}><Icon name="lucide:hourglass" /></span> : wait > 0 ? <span><Icon name="lucide:timer" /><b>{Math.ceil(wait / 1000)}</b></span> : null}
        </div>
      </header>
      <Bento cells={cells} attachments={choice.attachments} onOpen={(c) => setOpen(c.slot)} onTune={(c) => c.item && WEAPON_ATTACHMENTS[c.item] && setTuning(c.item)} />
      <footer className="wfl-bottom">
        <div className="wfl-spawns" aria-label="Điểm triển khai">
          <button type="button" className={spawn === null ? 'on' : ''} onClick={() => setSpawn(null)}><Icon name="lucide:sparkles" />Tự động</button>
          {state.deploy.filter((d) => d.safe).map((d) => <button key={d.id} type="button" className={spawn === d.id ? 'on' : ''} onClick={() => setSpawn(d.id)}><Icon name={d.kind === 'base' ? 'lucide:castle' : d.kind === 'squad' ? 'lucide:users' : 'lucide:flag'} />{d.name}</button>)}
        </div>
        {squads}
        <button className="btn" type="button" onClick={onLeave} title="Rời trận"><Icon name="lucide:log-out" /></button>
        {you.ready
          ? <button className="btn wfl-go" type="button" onClick={() => deploy(false)}><Icon name="lucide:x" /> Huỷ</button>
          : <button className="btn btn-primary wfl-go" type="button" onClick={() => deploy(true)}><Icon name="game-icons:parachute" /> TRIỂN KHAI</button>}
      </footer>
      {open && <WeaponGrid slot={open} cls={cls} choice={choice} onClose={() => setOpen(null)} onTune={setTuning}
        onPick={(id) => {
          if (open === 'gadget') { set({ gadgets: choice.gadgets.includes(id) ? choice.gadgets.filter((g) => g !== id) : [...choice.gadgets, id].slice(-kit.maxGadgets) }); return; }
          set(open === 'primary' ? { primary: id } : open === 'heavy' ? { heavy: id } : { secondary: id }); setOpen(null);
        }}
        onNone={open === 'heavy' || open === 'secondary' ? () => { set(open === 'heavy' ? { heavy: null } : { secondary: null }); setOpen(null); } : undefined} />}
      {tuning && <AttachmentPanel gun={tuning} current={choice.attachments[tuning] ?? saved.loadout[cls]?.attachments?.[tuning] ?? {}} onSet={(slot, id) => setAttachment(tuning, slot, id)} onClose={() => setTuning(null)} />}
    </div>
  );
}

/** Layer one: the chosen weapons, packed into one rectangle. */
function Bento({ cells, attachments, onOpen, onTune }: { cells: Cell[]; attachments: Record<string, Attachments>; onOpen: (c: Cell) => void; onTune: (c: Cell) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rects = useMemo(() => squarify(cells, { x: 0, y: 0, w: size.w, h: size.h }), [cells, size]);
  const gap = 6;
  return (
    <div className="wfl-bento" ref={host}>
      {size.w > 0 && cells.map((c) => {
        const r = rects.get(c.key);
        if (!r) return null;
        const att = c.item ? attachments[c.item] : undefined, tunable = !!c.item && !!WEAPON_ATTACHMENTS[c.item] && Object.keys(WEAPON_ATTACHMENTS[c.item]!).length > 0;
        const icon = c.item ? itemIconFor(c.item, att) : undefined;
        return (
          <button key={c.key} type="button" className={`wfl-cell ${c.slot}${c.item ? '' : ' empty'}`}
            style={{ left: r.x + gap / 2, top: r.y + gap / 2, width: Math.max(0, r.w - gap), height: Math.max(0, r.h - gap) }}
            onClick={() => onOpen(c)} onContextMenu={(e) => { e.preventDefault(); if (tunable) onTune(c); }}>
            <small className="wfl-tag">{SLOT_NAME[c.slot]}</small>
            {c.item ? (icon ? <img src={icon} alt="" draggable={false} /> : <Icon name="game-icons:pistol-gun" />) : <Icon name="lucide:plus" />}
            {c.item && <b className="wfl-name">{name(c.item)}</b>}
            {tunable && <span className="wfl-att" title="Chuột phải: phụ kiện">{ATTACHMENT_SLOTS.map((s) => att?.[s] ? <img key={s} src={itemIconFor(att[s]!)} alt={name(att[s]!)} /> : null)}<Icon name="lucide:settings-2" /></span>}
          </button>
        );
      })}
    </div>
  );
}

/** A gun's numbers as 0..1 bars against the strongest in the game. */
function stats(id: string): Array<[string, number, string]> | null {
  const w = WEAPON_BY_ITEM[id], spec = w ? weaponSpec(w) : undefined;
  if (!spec || spec.kind !== 'gun') return null;
  const dmg = spec.damage * Math.max(1, spec.pellets), rpm = Math.round(60_000 / spec.fireMs);
  return [
    ['Sát thương', Math.min(1, dmg / 150), String(Math.round(dmg))],
    ['Tốc độ', Math.min(1, rpm / 900), `${rpm}`],
    ['Tầm', Math.min(1, spec.range / 600), `${Math.round(spec.range)} m`],
    ['Băng', Math.min(1, spec.magazine / 100), String(spec.magazine)],
  ];
}

/** Layer two: the weapons that fit the slot, as a grid of models with their numbers. */
function WeaponGrid({ slot, cls, choice, onPick, onNone, onTune, onClose }: { slot: Slot; cls: WarfareClass; choice: ReturnType<typeof sanitizeWarfareLoadout>; onPick: (id: string) => void; onNone?: () => void; onTune: (gun: string) => void; onClose: () => void }) {
  const kit = WARFARE_KITS[cls];
  const list = slot === 'primary' ? kit.primary : slot === 'heavy' ? kit.heavy : slot === 'secondary' ? kit.secondary : kit.gadgets;
  const chosen = (id: string) => (slot === 'gadget' ? choice.gadgets.includes(id) : slot === 'primary' ? choice.primary === id : slot === 'heavy' ? choice.heavy === id : choice.secondary === id);
  return (
    <div className="wfl-layer" onClick={onClose}>
      <section className="wfl-grid-panel" onClick={(e) => e.stopPropagation()} aria-label={SLOT_NAME[slot]}>
        <header><h3>{SLOT_NAME[slot]}{slot === 'gadget' && <small> {choice.gadgets.length}/{kit.maxGadgets}</small>}</h3><button type="button" className="wfl-close" onClick={onClose} aria-label="Đóng"><Icon name="lucide:x" /></button></header>
        <div className="wfl-grid">
          {onNone && <button type="button" className="wfl-card none" onClick={onNone}><Icon name="lucide:ban" /><b>Không mang</b></button>}
          {list.map((id) => {
            const st = stats(id), tunable = !!WEAPON_ATTACHMENTS[id] && Object.keys(WEAPON_ATTACHMENTS[id]!).length > 0;
            const att = choice.attachments[id];
            return (
              <button key={id} type="button" className={`wfl-card${chosen(id) ? ' on' : ''}`} onClick={() => onPick(id)} onContextMenu={(e) => { e.preventDefault(); if (tunable) onTune(id); }}>
                <span className="wfl-card-img">{itemIconFor(id, att) ? <img src={itemIconFor(id, att)} alt="" draggable={false} /> : <Icon name="game-icons:pistol-gun" />}</span>
                <b>{name(id)}</b>
                {st && <dl>{st.map(([k, v, t]) => <div key={k}><dt>{k}</dt><dd><i style={{ width: `${v * 100}%` }} /></dd><span>{t}</span></div>)}</dl>}
                {tunable && <span className="wfl-att" title="Chuột phải: phụ kiện"><Icon name="lucide:settings-2" /></span>}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** Layer three: the gun in 3D with its sight and muzzle device, and what else fits each. */
function AttachmentPanel({ gun, current, onSet, onClose }: { gun: string; current: Attachments; onSet: (slot: AttachmentSlot, id: string | null) => void; onClose: () => void }) {
  const fits = WEAPON_ATTACHMENTS[gun] ?? {};
  return (
    <div className="wfl-layer top" onClick={onClose}>
      <section className="wfl-att-panel" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} aria-label={`Phụ kiện ${name(gun)}`}>
        <header><h3>{name(gun)}</h3><button type="button" className="wfl-close" onClick={onClose} aria-label="Đóng"><Icon name="lucide:x" /></button></header>
        <div className="wfl-att-body">
          <div className="wfl-att-model"><ModelPreview key={`${gun}|${current.optic ?? ''}|${current.muzzle ?? ''}`} model={{ item: gun }} attachments={current} title={name(gun)} /></div>
          <div className="wfl-att-slots">
            {ATTACHMENT_SLOTS.filter((s) => fits[s]?.length).map((s) => (
              <div key={s} className="wfl-att-slot">
                <small>{OPTIC_NAME[s]}</small>
                <div>
                  <button type="button" className={!current[s] ? 'on' : ''} onClick={() => onSet(s, null)} title="Không"><Icon name="lucide:ban" /></button>
                  {fits[s]!.map((a) => <button key={a} type="button" className={current[s] === a ? 'on' : ''} onClick={() => onSet(s, a)} title={name(a)}>{itemIconFor(a) ? <img src={itemIconFor(a)} alt="" /> : <Icon name="lucide:crosshair" />}<span>{name(a)}</span></button>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

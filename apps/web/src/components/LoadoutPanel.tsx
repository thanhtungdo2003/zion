'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { INFECTION_THROWABLES, ITEMS, WEAPON_BY_ITEM, infectionChoices, weaponSpec, type InfectionLoadout, type InfectionSlot } from '@zion/shared';
import type { InventoryStore } from '@/game/inventory/inventory';
import { loadInfectionLoadout, saveInfectionLoadout } from '@/lib/infection-loadout';
import { useSettings } from '@/lib/settings';
import { ItemArt } from './Inventory';
import { Icon } from './Icon';

/** Cell size of the weapon slots (matches the inventory grid). */
const CELL = 44;
const SLOTS: Array<{ slot: InfectionSlot; cols: number; rows: number; icon: string }> = [
  { slot: 'primary', cols: 6, rows: 2, icon: 'game-icons:ak47' },
  { slot: 'secondary', cols: 4, rows: 2, icon: 'game-icons:uzi' },
  { slot: 'melee', cols: 6, rows: 1, icon: 'game-icons:katana' },
];

/** Three bars, no numbers: hitting power, rate (or swing speed) and magazine (or reach). */
function stats(itemId: string): [number, number, number] {
  const spec = weaponSpec(WEAPON_BY_ITEM[itemId] ?? 0);
  if (spec?.kind === 'gun') return [Math.min(1, spec.damage * Math.max(1, spec.pellets) / 90), Math.min(1, 90 / spec.fireMs), Math.min(1, spec.magazine / 100)];
  if (spec?.kind === 'melee') return [Math.min(1, spec.damage / 80), Math.min(1, 450 / spec.cooldownMs), Math.min(1, spec.range / 4)];
  return [0, 0, 0];
}

function Bars({ itemId, melee }: { itemId: string; melee: boolean }) {
  const [a, b, c] = stats(itemId);
  const rows: Array<[string, number]> = [['lucide:crosshair', a], [melee ? 'lucide:wind' : 'lucide:gauge', b], [melee ? 'lucide:move-horizontal' : 'lucide:layers', c]];
  return <div className="lo-bars">{rows.map(([icon, v]) => <div key={icon} className="lo-bar"><Icon name={icon} /><i><b style={{ width: `${Math.round(v * 100)}%` }} /></i></div>)}</div>;
}

/**
 * Infection weapon picker: shaped like the inventory, but only the weapon rack. Two gun slots and
 * a melee slot, each showing its weapon; click a slot to swap that weapon. No text anywhere.
 */
export function LoadoutPanel({ store, onChange, locked }: { store: InventoryStore; onChange: (loadout: InfectionLoadout) => void; locked: boolean }) {
  const { item } = useSettings();
  const [loadout, setLoadout] = useState<InfectionLoadout>(() => loadInfectionLoadout());
  const [active, setActive] = useState<InfectionSlot | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const choices = useMemo(() => active ? infectionChoices(active) : [], [active]);

  useEffect(() => {
    if (active || !host.current || !store.preview) return;
    return store.preview.mount(host.current);
  }, [store, active]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape' && active) { e.stopPropagation(); setActive(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  const choose = (slot: InfectionSlot, id: string) => {
    const next = { ...loadout, [slot]: id };
    setLoadout(next); saveInfectionLoadout(next); onChange(next); setActive(null); setHover(null);
  };
  const shown = hover ?? (active ? loadout[active] : null);

  return (
    <div className="inv-overlay" onContextMenu={(e) => e.preventDefault()}>
      <div className="inv-panel lo-panel">
        <div className="lo-head">
          <Icon name="game-icons:biohazard" className="lo-mark" />
          {locked && <Icon name="lucide:lock-keyhole" className="lo-lock" />}
          <button type="button" className="inv-close" aria-label="Đóng" onClick={() => store.setOpen(false)}><Icon name="lucide:x" /></button>
        </div>
        <div className="lo-bento">
          <div className="lo-rack">
            {SLOTS.slice(0, 1).map((s) => <Slot key={s.slot} {...s} itemId={loadout[s.slot]} on={active === s.slot} locked={locked} onClick={() => setActive(active === s.slot ? null : s.slot)} label={item(loadout[s.slot])} />)}
            <div className="lo-row">
              <Slot {...SLOTS[1]!} itemId={loadout.secondary} on={active === 'secondary'} locked={locked} onClick={() => setActive(active === 'secondary' ? null : 'secondary')} label={item(loadout.secondary)} />
              <div className="lo-throw" aria-label="Lựu đạn">
                {INFECTION_THROWABLES.map((id, i) => <span key={i} className="lo-throw-cell"><ItemArt def={ITEMS[id]!} /></span>)}
              </div>
            </div>
            <Slot {...SLOTS[2]!} itemId={loadout.melee} on={active === 'melee'} locked={locked} onClick={() => setActive(active === 'melee' ? null : 'melee')} label={item(loadout.melee)} />
          </div>
          <div className="lo-side">
            {active ? (
              <div className="lo-picker">
                <div className="lo-choices" role="listbox" aria-label={active}>
                  {choices.map((id) => (
                    <button key={id} type="button" role="option" aria-selected={loadout[active] === id} aria-label={item(id)}
                      className={`lo-choice${loadout[active] === id ? ' on' : ''}`}
                      onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} onClick={() => choose(active, id)}>
                      <ItemArt def={ITEMS[id]!} />
                    </button>
                  ))}
                </div>
                {shown && <div className="lo-detail"><span className="lo-detail-art"><ItemArt def={ITEMS[shown]!} /></span><Bars itemId={shown} melee={active === 'melee'} /></div>}
              </div>
            ) : <div className="lo-view" ref={host} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A weapon slot: the weapon itself on a rack, with a swap tab and a hover lift that read as a button. */
function Slot({ cols, rows, icon, itemId, on, onClick, label }: { cols: number; rows: number; icon: string; itemId: string; on: boolean; onClick: () => void; label: string; locked?: boolean }) {
  const def = ITEMS[itemId];
  return (
    <button type="button" className={`lo-slot${on ? ' on' : ''}`} style={{ width: cols * CELL + 2, height: rows * CELL + 2 }} onClick={onClick} aria-label={label} aria-pressed={on}>
      <Icon name={icon} className="lo-slot-kind" />
      <span className="lo-slot-art">{def && <ItemArt def={def} />}</span>
      <span className="lo-slot-swap"><Icon name="lucide:repeat-2" /></span>
    </button>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { ATTACHMENTS, WEAPON_ATTACHMENTS, compatibleSlot, opticOf, type AttachmentSlot } from '@zion/shared';
import type { InventoryState, InventoryStore } from '@/game/inventory/inventory';
import { ITEMS } from '@/game/inventory/items';
import { useSettings } from '@/lib/settings';
import { GunStage, type GunAnchors } from './GunStage';
import { ItemArt } from './Inventory';
import { Icon } from './Icon';
import { NightVisionGuide } from './WeaponGuides';

const SLOT_LABEL: Record<AttachmentSlot, string> = { optic: 'Ống ngắm', muzzle: 'Đầu nòng' };

/**
 * Attachment screen (Alt while holding a gun, or right-click it in the inventory): the gun alone
 * on screen over the game, with a slot box beside each mounting point. Click a slot to pick what
 * goes in it, or to take it off.
 */
export function AttachmentPanel({ state, store }: { state: InventoryState; store: InventoryStore }) {
  const { item } = useSettings();
  const gun = state.items.find((i) => i.uid === state.attachGun);
  const [anchors, setAnchors] = useState<GunAnchors>({ rail: null, muzzle: null });
  const [open, setOpen] = useState<AttachmentSlot | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (open) setOpen(null); else store.closeAttachments();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [store, open]);
  if (!gun) return null;
  const slots = WEAPON_ATTACHMENTS[gun.itemId] ?? {};
  const mounted = gun.attachments ?? {};
  const parts = state.items.filter((i) => ATTACHMENTS[i.itemId]);
  // Where each slot box sits: above the rail, past the muzzle (stage-relative px).
  const place: Record<AttachmentSlot, { x: number; y: number; ax: number; ay: number } | null> = {
    optic: anchors.rail ? { x: anchors.rail.x, y: Math.max(56, anchors.rail.y - 120), ax: anchors.rail.x, ay: anchors.rail.y } : null,
    muzzle: anchors.muzzle ? { x: anchors.muzzle.x + 110, y: anchors.muzzle.y, ax: anchors.muzzle.x, ay: anchors.muzzle.y } : null,
  };
  return (
    <div className="att-screen" role="dialog" aria-modal="true" aria-label={`Phụ kiện: ${item(gun.itemId)}`} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <button type="button" className="att-close" aria-label="Đóng" onClick={() => store.closeAttachments()}><Icon name="lucide:x" /></button>
      <div className="att-stage">
        <GunStage itemId={gun.itemId} attachments={mounted} onAnchors={setAnchors} />
        <svg className="att-leaders" aria-hidden>
          {(['optic', 'muzzle'] as const).map((slot) => {
            const p = place[slot];
            return p && slots[slot] ? <g key={slot}><line x1={p.x} y1={p.y} x2={p.ax} y2={p.ay} /><circle cx={p.ax} cy={p.ay} r="3.5" /></g> : null;
          })}
        </svg>
        {(['optic', 'muzzle'] as const).map((slot) => {
          const p = place[slot], allowed = slots[slot];
          if (!p || !allowed) return null;
          const current = mounted[slot];
          const fits = parts.filter((i) => compatibleSlot(gun.itemId, i.itemId) === slot);
          const misfits = parts.filter((i) => ATTACHMENTS[i.itemId]!.slot === slot && compatibleSlot(gun.itemId, i.itemId) !== slot);
          return (
            <div key={slot} className={`att-slot${current ? ' filled' : ''}${open === slot ? ' open' : ''}`} style={{ left: p.x, top: p.y }}>
              <button type="button" className="att-slot-box" aria-expanded={open === slot} title={current ? item(current) : SLOT_LABEL[slot]} onClick={() => setOpen(open === slot ? null : slot)}>
                {current ? <ItemArt def={ITEMS[current]!} /> : <Icon name="lucide:plus" />}
              </button>
              <small className="att-slot-label">{current ? item(current) : SLOT_LABEL[slot]}</small>
              {open === slot && (
                <div className="att-menu" role="menu">
                  {current && <button type="button" role="menuitem" className="att-remove" onClick={() => { store.detach(gun.uid, slot); setOpen(null); }}><Icon name="lucide:unplug" /> Tháo {item(current)}</button>}
                  {fits.map((i) => <button key={i.uid} type="button" role="menuitem" onClick={() => { store.attach(gun.uid, i.uid); setOpen(null); }}>
                    <span className="att-art"><ItemArt def={ITEMS[i.itemId]!} /></span>{item(i.itemId)}
                  </button>)}
                  {misfits.map((i) => <button key={i.uid} type="button" role="menuitem" disabled className="misfit" title="Không vừa súng này">
                    <span className="att-art"><ItemArt def={ITEMS[i.itemId]!} /></span>{item(i.itemId)}<Icon name="lucide:ban" />
                  </button>)}
                  {!fits.length && !misfits.length && <p>Không có phụ kiện phù hợp trong túi.<br /><small>Lắp được: {allowed.map((id) => item(id)).join(', ')}</small></p>}
                </div>
              )}
              {slot === 'optic' && opticOf(mounted)?.nightVision && open !== slot && <div className="att-nv"><NightVisionGuide /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

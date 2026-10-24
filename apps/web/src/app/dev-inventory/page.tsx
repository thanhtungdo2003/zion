'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { notFound, useSearchParams } from 'next/navigation';
import { ARMOR_SLOTS, DEFAULT_APPEARANCE, NO_ARMOR, InventoryModel, carriedGear, type ArmorLoadout, type ArmorSlot } from '@zion/shared';
import { InventoryPanel } from '@/components/Inventory';
import { InventoryStore } from '@/game/inventory/inventory';
import { CharacterPreview } from '@/game/render/character-preview';
import { loadPlayerCharacter } from '@/game/render/character-model';
import { loadWeapons } from '@/game/render/weapons';
import { renderItemIcons } from '@/game/inventory/icons';

/**
 * Development only: the inventory with a sample loadout (backpack worn, three rifles, a pistol,
 * grenades, ammo and armour), for reviewing the layout without joining a game.
 * `?chest=1` opens a chest beside it; `?pack=0` takes the backpack off.
 */
export default function DevInventoryPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = useSearchParams();
  const [store] = useState(() => sampleStore(params.get('pack') !== '0', params.get('chest') === '1'));
  const state = useSyncExternalStore((f) => store.subscribe(f), store.get, store.get);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    void loadPlayerCharacter().then(async (character) => {
      if (disposed) return;
      const weapons = await loadWeapons(character);
      try { renderItemIcons(weapons); } catch { /* icons are optional here */ }
      const preview = new CharacterPreview(character);
      preview.setAppearance(DEFAULT_APPEARANCE);
      const st = store.get(), worn: ArmorLoadout = { ...NO_ARMOR };
      for (const s of ARMOR_SLOTS as readonly ArmorSlot[]) worn[s] = store.wornArmor()[s];
      preview.setArmor(worn);
      preview.setEquipment(store.equippedItemId(), store.stance(), carriedGear(st.items, st.equipped), weapons);
      store.preview = preview;
      // Re-mount so the model view picks the preview up.
      store.setOpen(false);
      if (params.get('chest') === '1') { store.openChest('dev'); store.applyChest(sampleChest()); } else store.setOpen(true, null);
      setReady(true);
      setTimeout(() => { (window as unknown as { invReady?: boolean }).invReady = true; }, 500);
    });
    return () => { disposed = true; };
  }, [store, params]);
  return <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(160deg, #3b4a3a, #1c2226 60%, #2b2a24)' }}>{ready && <InventoryPanel state={state} store={store} coins={1250} />}</div>;
}

function sampleStore(pack: boolean, chest: boolean): InventoryStore {
  const m = new InventoryModel({ items: [], equipped: null });
  if (pack) m.add('military_backpack');
  const rifle = m.add('ak47')!;
  m.add('m4a1'); m.add('shotgun'); m.add('gl18'); m.add('grenade'); m.add('grenade');
  for (const id of ['ammo_762', 'ammo_556', 'ammo_9mm', 'ammo_12g', 'medkit', 'potato_cooked', 'flashlight']) m.add(id);
  for (const [id, slot] of [['helmet_k63', 'armor_head'], ['mask_shemagh', 'armor_face'], ['headset_comms', 'armor_ears'], ['vest_c75', 'armor_chest']] as const) {
    const it = m.add(id)!;
    m.move(it.uid, slot, 0, 0, false);
  }
  m.equip(rifle.uid);
  const store = new InventoryStore();
  store.applyServer(m.items, m.equipped);
  store.setOpen(true, chest ? 'chest' : null);
  return store;
}

function sampleChest() {
  const items = ['ammo_762', 'medkit', 'grenade', 'mp5', 'scope_2x', 'cooked_mutton'].map((itemId, i) => ({ uid: i + 1, itemId, container: 'backpack' as const, x: 0, y: 0, rotated: false }));
  return { t: 'chest' as const, id: 'dev', field: true, capacity: 24, searchRemainingMs: 0, busy: false, items, searched: true, revision: 1 };
}

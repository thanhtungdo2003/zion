'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GameEngine } from '@/game/engine';
import { HudStore } from '@/game/hud-store';
import { InventoryStore } from '@/game/inventory/inventory';
import { Hud } from './Hud';
import { NpcDialogue, PlantPanel, QuestTracker, SideTabs, StaminaBar } from './Quests';
import { ArmorHud, Hotbar, InventoryPanel } from './Inventory';

export default function GameView() {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [store] = useState(() => new HudStore());
  const hud = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [inventory] = useState(() => new InventoryStore());
  const inv = useSyncExternalStore(inventory.subscribe, inventory.get, inventory.get);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const engine = new GameEngine(el, store, inventory);
    engineRef.current = engine;
    void engine.start();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [store, inventory]);

  useEffect(() => {
    engineRef.current?.setInventoryOpen(inv.open);
  }, [inv.open]);

  const inWorld = hud.status === 'playing' || hud.status === 'dead';
  useEffect(() => {
    if (!inWorld && inventory.get().open) inventory.setOpen(false);
  }, [inWorld, inventory]);

  // Talking to an NPC: a tab rail switches between their quests and our inventory.
  const switching = useRef(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    // Closing the inventory (E / Esc) while it was opened from a dialogue ends the conversation.
    if (wasOpen.current && !inv.open && !switching.current) engineRef.current?.closeDialogue();
    switching.current = false;
    wasOpen.current = inv.open;
  }, [inv.open]);
  const rail = (on: 'quests' | 'inventory') => (
    <SideTabs
      active={on}
      onQuests={() => { if (on !== 'quests') { switching.current = true; inventory.setOpen(false); } }}
      onInventory={() => { if (on !== 'inventory') { switching.current = true; inventory.setOpen(true); } }}
    />
  );
  // Private UI click for every press on the HUD (buttons, inventory, tabs…) unless that control
  // has its own sound (data-nosound).
  const onClickCapture = (e: React.MouseEvent) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el.tagName === 'CANVAS' || el.closest('[data-nosound]')) return;
    if (el.closest('button, a, input, select, .inv-panel, .q-dialog, .plant-panel, .side-tabs, .hb-item, .overlay-card')) engineRef.current?.uiClick();
  };

  const attachMinimap = useCallback((canvas: HTMLCanvasElement | null) => {
    engineRef.current?.attachMinimap(canvas);
  }, []);

  return (
    <div className="game-root" onMouseDownCapture={onClickCapture}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      <Hud
        state={hud}
        onMinimap={attachMinimap}
        onChatOpen={(open) => engineRef.current?.setChatOpen(open)}
        onChat={(text) => engineRef.current?.sendChat(text)}
        onRespawn={() => engineRef.current?.requestRespawn()}
        onResume={() => engineRef.current?.lockPointer()}
        onLeave={() => router.push('/')}
        inventoryOpen={inv.open || !!hud.dialogue}
        onSetTime={(tod) => engineRef.current?.setTimeOfDay(tod)}
      />
      {inWorld && <QuestTracker quests={hud.quests} position={hud.position} />}
      {inWorld && hud.dialogue && !inv.open && <NpcDialogue side={rail('quests')} npc={hud.dialogue.npc} name={hud.dialogue.name} quests={hud.quests} onOp={(op, q) => engineRef.current?.quest(op, hud.dialogue!.npc, q)} trades={hud.life?.config.trades.filter((t) => t.npc === hud.dialogue!.npc) ?? []} owned={(item) => inv.items.filter((i) => i.itemId === item).reduce((n, i) => n + (i.count ?? 1), 0)} coins={hud.coins} onTrade={(side, id) => engineRef.current?.lifeAction(side, id)} onClose={() => engineRef.current?.closeDialogue()} />}
      {inWorld && hud.life && <StaminaBar life={hud.life} />}
      {inWorld && hud.life && hud.plot && <PlantPanel life={hud.life} items={inv.items} onPlant={(crop) => engineRef.current?.lifeAction('plant', hud.plot!, crop)} />}
      {inWorld && <Hotbar state={inv} ammo={hud.ammo} />}
      {inWorld && <ArmorHud state={inv} />}
      {inWorld && inv.open && <InventoryPanel state={inv} store={inventory} coins={hud.coins} side={hud.dialogue ? rail('inventory') : undefined} />}
    </div>
  );
}

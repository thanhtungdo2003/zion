'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { WEAPON_BY_ITEM, weaponSpec } from '@zion/shared';
import { useSettings } from '@/lib/settings';
import { MobileControls, type TouchControlsPort } from './MobileControls';
import { GameEngine } from '@/game/engine';
import { HudStore } from '@/game/hud-store';
import { InventoryStore } from '@/game/inventory/inventory';
import { Hud } from './Hud';
import { Onboarding } from './Onboarding';
import { DownedPanel, NpcDialogue, PlantPanel, QuestTracker, ReviveBar, SideTabs, StaminaBar } from './Quests';
import { ArmorHud, Hotbar, InventoryPanel } from './Inventory';

export default function GameView() {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [store] = useState(() => new HudStore());
  const hud = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [inventory] = useState(() => new InventoryStore());
  const inv = useSyncExternalStore(inventory.subscribe, inventory.get, inventory.get);
  const { touchControls } = useSettings();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRequest, setChatRequest] = useState(0);
  const [tutorialBlocked, setTutorialBlocked] = useState(false);
  const touch = useMemo<TouchControlsPort>(() => ({
    move: (x, z) => engineRef.current?.touchMove(x, z),
    button: (button, down) => engineRef.current?.touchButton(button, down),
    look: (dx, dy) => engineRef.current?.touchLook(dx, dy),
    fireDirection: (x, y) => engineRef.current?.touchFireDirection(x, y),
    action: (action) => engineRef.current?.touchAction(action),
    reset: () => engineRef.current?.resetTouch(),
    chat: () => setChatRequest((n) => n + 1),
  }), []);
  const equipped = inv.items.find((i) => i.uid === inv.equipped);
  const spec = weaponSpec(equipped ? WEAPON_BY_ITEM[equipped.itemId] ?? 0 : 0);
  const touchVisible = touchControls && hud.status === 'playing' && hud.pointerLocked && !inv.open && !hud.dialogue && hud.downed === null && !chatOpen && !tutorialBlocked;

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

  const blockTutorial = useCallback((block: boolean) => {
    setTutorialBlocked(block); engineRef.current?.setTutorialBlocked(block);
  }, []);

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
    <div className={`game-root${touchControls ? ' touch-mode' : ''}`} onMouseDownCapture={onClickCapture}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {touchVisible && <MobileControls controls={touch} canAim={spec?.kind === 'gun' && !!spec.scope} canReload={spec?.kind === 'gun'} reloading={hud.ammo?.reload !== null && hud.ammo?.reload !== undefined} rollCooldown={hud.rollCd} weaponUid={inv.equipped} />}
      <Hud
        state={hud}
        onMinimap={attachMinimap}
        onChatOpen={(open) => { setChatOpen(open); engineRef.current?.setChatOpen(open); }}
        chatRequest={chatRequest}
        onChat={(text, channel) => engineRef.current?.sendChat(text, channel)}
        onRespawn={() => engineRef.current?.requestRespawn()}
        onResume={() => engineRef.current?.lockPointer()}
        onLeave={() => router.push('/')}
        inventoryOpen={inv.open || !!hud.dialogue}
        onSetTime={(tod) => engineRef.current?.setTimeOfDay(tod)}
      />
      {inWorld && <QuestTracker quests={hud.quests} position={hud.position} onCancel={(q) => engineRef.current?.quest('cancel', q.npc, q.id)} />}
      {inWorld && hud.dialogue && !inv.open && <NpcDialogue side={rail('quests')} npc={hud.dialogue.npc} name={hud.dialogue.name} quests={hud.quests} onOp={(op, q) => engineRef.current?.quest(op, hud.dialogue!.npc, q)} trades={hud.life?.config.trades.filter((t) => t.npc === hud.dialogue!.npc) ?? []} owned={(item) => inv.items.filter((i) => i.itemId === item).reduce((n, i) => n + (i.count ?? 1), 0)} coins={hud.coins} onTrade={(side, id) => engineRef.current?.lifeAction(side, id)} onClose={() => engineRef.current?.closeDialogue()} />}
      {inWorld && hud.life && <StaminaBar life={hud.life} />}
      {inWorld && hud.downed !== null && <DownedPanel bleed={hud.downed} onHelp={() => engineRef.current?.callForHelp()} onGiveUp={() => engineRef.current?.giveUp()} />}
      {inWorld && hud.reviving && <ReviveBar start={hud.reviving.start} end={hud.reviving.end} />}
      {inWorld && hud.life && hud.plot && <PlantPanel life={hud.life} items={inv.items} onPlant={(crop) => engineRef.current?.lifeAction('plant', hud.plot!, crop)} />}
      {inWorld && <Onboarding hud={hud} onBlock={blockTutorial} />}
      {inWorld && <Hotbar state={inv} ammo={hud.ammo} touchVisible={touchVisible} onSelect={(slot) => engineRef.current?.touchSelectWeapon(slot)} />}
      {inWorld && <ArmorHud state={inv} />}
      {inWorld && inv.open && <InventoryPanel state={inv} store={inventory} coins={hud.coins} side={hud.dialogue ? rail('inventory') : undefined} />}
    </div>
  );
}

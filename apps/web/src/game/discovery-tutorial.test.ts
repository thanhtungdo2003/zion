import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_LIFE, type TutorialId } from '@zion/shared';
import { initialHud } from './hud-store';
import { InventoryStore } from './inventory/inventory';
import { discoveryLesson, lessonContextOpen } from './discovery-tutorial';

describe('discovery guidance', () => {
  it('continues with each NPC after the base guide was skipped, including focused quest and trade buttons', () => {
    const hud = initialHud(), inv = new InventoryStore().get();
    hud.life = { t: 'baseLife', config: DEFAULT_BASE_LIFE, objects: [], plots: {}, animalLoot: [], stamina: 100, capacity: 100, action: null };
    hud.dialogue = { npc: 'farmer', name: 'Bác Ba' };
    const seen = new Set<TutorialId>(['intro']);
    const lesson = discoveryLesson(hud, inv, seen)!;
    expect(lesson.id).toBe('npc_farmer');
    expect(lesson.steps.some((s) => s.focus === '[data-guide="npc-quests"]')).toBe(true);
    expect(lesson.steps.some((s) => s.focus === '[data-guide="npc-trade"]')).toBe(true);
    seen.add(lesson.id);
    expect(discoveryLesson(hud, inv, seen)).toBeNull();
    hud.dialogue = { npc: 'chef', name: 'Đầu bếp' };
    expect(discoveryLesson(hud, inv, seen)?.id).toBe('npc_chef');
    hud.dialogue = null;
    expect(lessonContextOpen(lesson, hud, inv)).toBe(false);
  });
  it('introduces Search only for field chests and retains unseen combat guidance for later', () => {
    const hud = initialHud(), inv = { ...new InventoryStore().get(), open: true, station: 'chest' as const };
    hud.tutorial = { seen: ['intro'], firstZombie: true };
    const seen = new Set<TutorialId>(['intro']);
    inv.chest = { t: 'chest', id: 'test', field: true, capacity: 20, items: [], searched: false, searchRemainingMs: 0, busy: false, revision: 0 };
    const lesson = discoveryLesson(hud, inv, seen)!;
    expect(lesson.id).toBe('chest');
    expect(lesson.steps.some((s) => s.focus === '.chest-search button')).toBe(true);
    expect(lesson.steps.some((s) => s.text.includes('Mỗi ngày trong game'))).toBe(true);
    seen.add('chest');
    expect(discoveryLesson(hud, inv, seen)?.id).toBe('zombie');
    inv.chest.field = false;
    expect(discoveryLesson(hud, inv, new Set())?.id).toBe('zombie');
  });
  it('covers the service panels and map with UI highlights', () => {
    const hud = initialHud(), inv = new InventoryStore().get();
    for (const station of ['shop', 'nurse', 'stash'] as const) {
      const lesson = discoveryLesson(hud, { ...inv, open: true, station }, new Set())!;
      expect(lesson.id).toBe(station === 'shop' ? 'merchant' : station);
      expect(lesson.steps.every((s) => !!s.focus)).toBe(true);
    }
    hud.mapOpen = true;
    expect(discoveryLesson(hud, inv, new Set())?.id).toBe('map');
  });
});

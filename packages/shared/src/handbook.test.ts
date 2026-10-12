import { describe, expect, it } from 'vitest';
import { buildHandbook, HANDBOOK_CATEGORIES } from './handbook';
import { DEFAULT_CONTENT } from './content';
import { ITEMS } from './items';
import { WEAPON_BY_ITEM, WEAPON_SPECS } from './weapons';

describe('survival handbook', () => {
  it('covers every catalog item, every active monster variant and all five sections', () => {
    const entries = buildHandbook();
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
    expect(new Set(entries.map(e => e.category))).toEqual(new Set(Object.keys(HANDBOOK_CATEGORIES)));
    expect(entries.filter(e => e.category === 'monsters')).toHaveLength(4);
    for (const item of Object.values(ITEMS)) expect(entries.find(e => e.itemId === item.id)).toMatchObject({ title: item.name });
  });
  it('reads weapon balance from the actual game spec', () => {
    const entry = buildHandbook().find(e => e.itemId === 'ak47')!;
    expect(entry.stats.find(s => s.label === 'Sát thương')?.value).toBe(String(WEAPON_SPECS[WEAPON_BY_ITEM.ak47! as 1].damage));
  });
  it('follows Studio changes to NPC names, models, enabled quests and item models', () => {
    const content = structuredClone(DEFAULT_CONTENT);
    content.npcs[0]!.name = 'Người trồng trọt';
    content.npcs[0]!.model = '/models/npcs/armored-soldier.bbmodel';
    content.quests = content.quests.filter(q => q.npc !== content.npcs[0]!.id);
    content.baseLife!.itemModels!.potato = '/models/materias/potato-cooked.bbmodel';
    const entries = buildHandbook(content);
    const npc = entries.find(e => e.id === 'npc.farmer')!;
    expect(npc.title).toBe('Người trồng trọt');
    expect(npc.model).toEqual({ url: '/models/npcs/armored-soldier.bbmodel' });
    expect(npc.stats.find(s => s.label === 'Nhiệm vụ')).toBeUndefined();
    expect(entries.find(e => e.itemId === 'potato')?.model).toEqual({ url: '/models/materias/potato-cooked.bbmodel' });
  });
});

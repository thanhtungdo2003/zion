import { describe, expect, it } from 'vitest';
import { DEFAULT_RANK_CONFIG, rankConfigSchema, rankStep, rankTitle } from './ranks';
import { COLONEL_SEARCH_QUESTS } from './colonel-search';

describe('military career', () => {
  it('has exactly five titles with five stars and escalating, attainable thresholds', () => {
    expect(rankConfigSchema.safeParse(DEFAULT_RANK_CONFIG).success).toBe(true);
    expect(rankTitle(0).title).toBe('Tân Binh I');
    expect(rankTitle(6).title).toBe('Binh Nhì II');
    expect(rankTitle(24).title).toBe('Tinh Nhuệ V');
    DEFAULT_RANK_CONFIG.thresholds.forEach((score, i) => {
      expect(rankStep(score, DEFAULT_RANK_CONFIG)).toBe(i);
      if (i) expect(rankStep(score - 1, DEFAULT_RANK_CONFIG)).toBe(i - 1);
    });
    const bad = structuredClone(DEFAULT_RANK_CONFIG); bad.thresholds[3] = 1;
    expect(rankConfigSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects invalid item grants and ships ten private retrieval assignments without fixed destinations', () => {
    const bad = structuredClone(DEFAULT_RANK_CONFIG);
    bad.rewards[1] = [{ kind: 'item', id: 'fake', name: 'Fake', mode: 'survival', quantity: 1 }];
    expect(rankConfigSchema.safeParse(bad).success).toBe(false);
    expect(COLONEL_SEARCH_QUESTS).toHaveLength(10);
    for (const q of COLONEL_SEARCH_QUESTS) {
      expect(q.npc).toBe('colonel');
      expect(q.objectives.map((o) => o.type)).toEqual(['retrieve', 'deliver']);
      expect(q.objectives[0]).not.toHaveProperty('location');
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { LlmClient } from './llm';
import { planRegion, regionRequestSchema } from './region-planner';

const req = (prompt: string, region: Partial<{ area: number; water: number; slope: number; elevation: number }> = {}) =>
  regionRequestSchema.parse({ prompt, region: { area: 60_000, width: 250, depth: 240, water: 0, elevation: 30, slope: .05, ...region } });
const published = [
  { asset: 3001, name: 'Doanh trại', def: { category: 'structure', tags: ['model-studio', 'kind:building'], fit: { lots: ['military'], conditions: ['intact', 'abandoned'], areas: ['military-base'] } } },
  { asset: 3002, name: 'Nhà ống', def: { category: 'structure', tags: ['model-studio', 'kind:building'], fit: { lots: ['residential', 'commercial'], conditions: ['intact'], areas: [] } } },
  { asset: 3003, name: 'Xe tải', def: { category: 'structure', tags: ['model-studio', 'kind:vehicle'] } },
];

describe('World Studio region planner', () => {
  it('reads the request, then the ground, and lists the buildings that will stand there', async () => {
    const base = await planRegion(req('căn cứ quân sự bỏ hoang trên đồi'), published, null);
    expect(base).toMatchObject({ kind: 'military', condition: 'abandoned', preset: 'military-base', source: 'rules' });
    expect(base.buildings.map((b) => b.asset)).toEqual([3001]);
    expect((await planRegion(req('', { water: .3 }), published, null)).kind).toBe('port');
    expect((await planRegion(req('', { area: 500_000 }), published, null)).kind).toBe('city');
    const town = await planRegion(req('thị trấn Việt Nam'), published, null);
    expect(town).toMatchObject({ kind: 'town', style: 'vn-town', preset: 'vn-town' });
    expect(town.buildings.map((b) => b.asset)).toEqual([3002]);
  });

  it('takes the AI answer when it is one of the shared kinds and conditions, else the rules', async () => {
    const llm = (text: string) => ({ complete: async () => ({ text, model: 'x' }) }) as unknown as LlmClient;
    const ai = await planRegion(req(''), published, llm('{"kind":"city","condition":"ruined","style":"planned-city","name":"Thành phố Tro Tàn","reason":"rộng"}'));
    expect(ai).toMatchObject({ kind: 'city', condition: 'ruined', preset: 'abandoned-city', name: 'Thành phố Tro Tàn', source: 'ai' });
    const bad = await planRegion(req('làng'), published, llm('{"kind":"castle","condition":"new"}'));
    expect(bad).toMatchObject({ kind: 'village', source: 'rules' });
  });
});

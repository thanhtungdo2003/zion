import { describe, expect, it } from 'vitest';
import { emptyDoc } from '@zion/assets/model-studio';
import type { LlmClient } from './llm';
import { classifyWithAi } from './ai-classify';

const llm = (text: string) => ({ complete: async () => ({ text, model: 'x' }) }) as unknown as LlmClient;

describe('Model Studio: the AI sorts a model out', () => {
  it('takes the AI answer within the shared lists, adds the lot classes of its types', async () => {
    const doc = { ...emptyDoc('Công trình 1'), kind: 'building' as const };
    const c = await classifyWithAi(doc, llm('{"kind":"building","types":["school","castle"],"lots":[],"conditions":["intact","new"],"settlements":["town"],"reason":"có lớp học"}'));
    expect(c.source).toBe('ai');
    expect(c.fit).toMatchObject({ types: ['school'], lots: ['residential'], conditions: ['intact'] });
    expect(c.fit!.areas).toContain('vn-town');
  });
  it('falls back to the rules without an AI or on nonsense', async () => {
    const doc = emptyDoc('Bệnh viện');
    expect((await classifyWithAi(doc, null)).source).toBe('rules');
    expect((await classifyWithAi(doc, llm('xin chào'))).source).toBe('rules');
  });
});

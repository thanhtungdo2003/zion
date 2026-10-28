import { describe, expect, it } from 'vitest';
import { AiSettings, DEFAULT_MODELS } from './ai-settings';
import type { Db } from '../db/pool';

/** server_settings in memory. */
function fakeDb() {
  const rows = new Map<string, unknown>();
  const db = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT')) return { rows: rows.has(params[0] as string) ? [{ value: rows.get(params[0] as string) }] : [] };
      rows.set(params[0] as string, JSON.parse(params[1] as string));
      return { rows: [] };
    },
  };
  return { db: db as unknown as Db, rows };
}
const env = { baseUrl: 'https://ai.example/v1', model: 'cx/gpt-5.6-sol', timeoutMs: 5000, retries: 1 };

describe('Model Studio AI settings', () => {
  it('stores the key encrypted, reports only its last characters, and survives a restart', async () => {
    const { db, rows } = fakeDb();
    const a = new AiSettings(db, 'server-secret-0123456789', env);
    await a.load();
    expect(a.status()).toMatchObject({ configured: false, source: null, keyHint: null });
    expect(a.client()).toBeNull();
    const st = await a.update({ apiKey: 'sk-test-SECRET-9876', model: 'cx/gpt-6-astra' });
    expect(st).toEqual({ configured: true, source: 'studio', keyHint: '…9876', baseUrl: env.baseUrl, model: 'cx/gpt-6-astra', imageModel: 'cx/gpt-image-2.5' });
    expect(JSON.stringify([...rows.values()])).not.toContain('SECRET');
    expect(JSON.stringify(st)).not.toContain('SECRET');
    expect(a.client()!.config).toMatchObject({ apiKey: 'sk-test-SECRET-9876', model: 'cx/gpt-6-astra' });
    // A new process with the same server secret reads it back; another secret cannot.
    const b = new AiSettings(db, 'server-secret-0123456789', env);
    await b.load();
    expect(b.client()!.config.apiKey).toBe('sk-test-SECRET-9876');
    const c = new AiSettings(db, 'other-secret-0123456789', env);
    await c.load();
    expect(c.status().configured).toBe(false);
  });

  it('lets the Studio key win over the environment, and removing it falls back', async () => {
    const { db } = fakeDb();
    const a = new AiSettings(db, 'server-secret-0123456789', { ...env, apiKey: 'env-key-AAAA' });
    await a.load();
    expect(a.status()).toMatchObject({ source: 'env', keyHint: '…AAAA' });
    await a.update({ apiKey: 'studio-key-BBBB' });
    expect(a.status().source).toBe('studio');
    await a.update({ apiKey: '' });
    expect(a.status()).toMatchObject({ source: 'env', keyHint: '…AAAA' });
  });

  it('lists the endpoint models, and falls back to the known ones without leaking the key', async () => {
    const { db } = fakeDb();
    const a = new AiSettings(db, 'server-secret-0123456789', env);
    await a.load();
    expect((await a.listModels()).models).toEqual(expect.arrayContaining(DEFAULT_MODELS));
    await a.update({ apiKey: 'sk-test-SECRET-9876' });
    let auth = '';
    const ok = (async (_url: string, init: { headers: Record<string, string> }) => { auth = init.headers.authorization!; return new Response(JSON.stringify({ data: [{ id: 'm-b' }, { id: 'm-a' }, { id: 'm-a' }] })); }) as unknown as typeof fetch;
    expect(await a.listModels(ok)).toEqual({ models: ['m-a', 'm-b'], error: null });
    expect(auth).toBe('Bearer sk-test-SECRET-9876');
    await a.update({ baseUrl: 'https://other.example/v1' });
    const bad = (async () => new Response('invalid key sk-test-SECRET-9876', { status: 401 })) as unknown as typeof fetch;
    const r = await a.listModels(bad);
    expect(r.error).toContain('401');
    expect(r.error).not.toContain('SECRET');
    expect(r.models).toContain('cx/gpt-5.6-sol');
  });
});

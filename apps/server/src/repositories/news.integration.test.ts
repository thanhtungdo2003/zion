import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewsContent } from '@zion/shared';
import { NewsRepository } from './news';

/** Opt-in PostgreSQL verification in an isolated, disposable schema. */
describe.skipIf(process.env.ZION_NEWS_INTEGRATION !== '1' || !process.env.DATABASE_URL)('PostgreSQL news publication', () => {
  const schema = `codex_news_test_${randomUUID().replaceAll('-', '')}`;
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 4 });
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const news = new NewsRepository(db);
  let created = false;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    await db.query('CREATE TABLE accounts(id uuid PRIMARY KEY)');
    await db.query(await readFile(new URL('../../migrations/014_news_posts.sql', import.meta.url), 'utf8'));
  });
  afterAll(async () => {
    await db.end();
    if (!/^codex_news_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it('isolates drafts, publishes a snapshot, rejects concurrent stale saves and persists across repository instances', async () => {
    const id = randomUUID();
    const content: NewsContent = { title: 'Tin từ căn cứ', version: '0.2', summary: 'Thông tin mới', body: 'Nội dung đã được biên tập.', category: 'update', pinned: false };
    const saved = (await news.act({ op: 'save', id, revision: 0, content }, null))!;
    expect(await news.published()).toEqual([]);
    const posted = (await news.act({ op: 'publish', id, revision: saved.revision }, null))!;
    expect((await news.published())[0]?.body).toBe(content.body);
    const writes = await Promise.allSettled([1, 2].map(n => news.act({ op: 'save', id, revision: posted.revision, content: { ...content, body: `Bản nháp mới ${n}` } }, null)));
    expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await new NewsRepository(db).published())[0]?.body).toBe(content.body);
    const latest = (await news.drafts())[0]!;
    const republished = (await news.act({ op: 'publish', id, revision: latest.revision }, null))!;
    expect(republished.published!.revision).toBeGreaterThan(posted.published!.revision);
    const hidden = (await news.act({ op: 'unpublish', id, revision: republished.revision }, null))!;
    expect(await news.published()).toEqual([]); expect(hidden.content.body).toContain('Bản nháp mới');
    await news.act({ op: 'delete', id, revision: hidden.revision }, null);
    expect(await news.drafts()).toEqual([]);
  });
});

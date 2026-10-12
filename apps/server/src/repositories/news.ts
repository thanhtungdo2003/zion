import { newsActionSchema, sortNews, type NewsAction, type NewsContent, type NewsDraft, type NewsPost } from '@zion/shared';
import type { Db } from '../db/pool';

interface NewsRow {
  id: string; revision: number; draft: NewsContent; published: NewsContent | null;
  published_revision: number | null; published_at: Date | null; updated_at: Date;
}
function publicPost(row: NewsRow): NewsPost | null {
  if (!row.published || !row.published_at || !row.published_revision) return null;
  return { ...row.published, id: row.id, revision: row.published_revision, publishedAt: new Date(row.published_at).toISOString() };
}
function draft(row: NewsRow): NewsDraft {
  return { id: row.id, revision: row.revision, content: row.draft, published: publicPost(row), updatedAt: new Date(row.updated_at).toISOString() };
}
export interface NewsBackend {
  published(): Promise<NewsPost[]>;
  drafts(): Promise<NewsDraft[]>;
  act(action: NewsAction, actorId: string | null): Promise<NewsDraft | null>;
}
export class NewsRepository implements NewsBackend {
  constructor(private readonly db: Db) {}
  async published(): Promise<NewsPost[]> {
    const { rows } = await this.db.query<NewsRow>('SELECT id, published, published_revision, published_at FROM news_posts WHERE published IS NOT NULL ORDER BY published_at DESC');
    return sortNews(rows.flatMap(row => { const post = publicPost(row); return post ? [post] : []; }));
  }
  async drafts(): Promise<NewsDraft[]> {
    const { rows } = await this.db.query<NewsRow>('SELECT * FROM news_posts ORDER BY updated_at DESC, id');
    return rows.map(draft);
  }
  async act(raw: NewsAction, actorId: string | null): Promise<NewsDraft | null> {
    const action = newsActionSchema.parse(raw);
    let rows: NewsRow[];
    if (action.op === 'save') {
      if (action.revision === 0) {
        ({ rows } = await this.db.query<NewsRow>(`INSERT INTO news_posts(id, draft, updated_by) VALUES ($1, $2::jsonb, $3)
          ON CONFLICT(id) DO NOTHING RETURNING *`, [action.id, JSON.stringify(action.content), actorId]));
      } else {
        ({ rows } = await this.db.query<NewsRow>(`UPDATE news_posts SET draft = $3::jsonb, revision = revision + 1, updated_at = now(), updated_by = $4
          WHERE id = $1 AND revision = $2 RETURNING *`, [action.id, action.revision, JSON.stringify(action.content), actorId]));
      }
    } else {
      const sql = action.op === 'delete'
        ? 'DELETE FROM news_posts WHERE id = $1 AND revision = $2 RETURNING *'
        : `UPDATE news_posts SET ${action.op === 'publish' ? 'published = draft, published_revision = revision + 1, published_at = now()' : 'published = NULL, published_revision = NULL, published_at = NULL'},
          revision = revision + 1, updated_at = now(), updated_by = $3 WHERE id = $1 AND revision = $2 RETURNING *`;
      ({ rows } = await this.db.query<NewsRow>(sql, action.op === 'delete' ? [action.id, action.revision] : [action.id, action.revision, actorId]));
    }
    if (!rows[0]) throw Object.assign(new Error('Bài viết đã thay đổi hoặc bị xóa ở phiên khác. Hãy tải lại danh sách trước khi sửa tiếp.'), { statusCode: 409 });
    return action.op === 'delete' ? null : draft(rows[0]);
  }
}

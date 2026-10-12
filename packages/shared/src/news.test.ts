import { describe, expect, it } from 'vitest';
import { isNewsUnread, newsActionSchema, sortNews, type NewsPost } from './news';

const id = '09b43208-d339-484c-b4df-274fb42eb986';
const post: NewsPost = { id, revision: 2, title: 'Bản cập nhật', version: '0.2', summary: 'Những điểm mới', body: 'Nội dung cập nhật mới.', category: 'update', pinned: false, publishedAt: '2026-10-12T00:00:00.000Z' };
describe('news publication contract', () => {
  it('validates articles, operation revisions and payload limits', () => {
    const { id: _id, revision: _revision, publishedAt: _publishedAt, ...content } = post;
    expect(newsActionSchema.safeParse({ op: 'save', id, revision: 0, content }).success).toBe(true);
    expect(newsActionSchema.safeParse({ op: 'save', id, revision: 0, content: { ...content, body: ' ' } }).success).toBe(false);
    expect(newsActionSchema.safeParse({ op: 'save', id, revision: 0, content: { ...content, body: 'a'.repeat(30_001) } }).success).toBe(false);
    expect(newsActionSchema.safeParse({ op: 'publish', id, revision: 0 }).success).toBe(false);
    expect(newsActionSchema.safeParse({ op: 'publish', id, revision: 1, actorId: 'forged' }).success).toBe(false);
  });
  it('only restores the yellow badge after a new publication revision', () => {
    expect(isNewsUnread(post, {})).toBe(true);
    expect(isNewsUnread(post, { [id]: 2 })).toBe(false);
    expect(isNewsUnread({ ...post, revision: 3 }, { [id]: 2 })).toBe(true);
  });
  it('pins older notices before newer posts without changing the input', () => {
    const newer = { ...post, id: 'newer', publishedAt: '2026-10-13T00:00:00.000Z' };
    const pinned = { ...post, id: 'pinned', pinned: true };
    const posts = [post, newer, pinned];
    expect(sortNews(posts).map(p => p.id)).toEqual(['pinned', 'newer', id]);
    expect(posts[0]).toBe(post);
  });
});

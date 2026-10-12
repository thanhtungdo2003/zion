import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewsPost } from '@zion/shared';
import { getNews } from './api';
import { NewsStore } from './news-store';
vi.mock('./api', () => ({ getNews: vi.fn() }));
const post: NewsPost = { id: '09b43208-d339-484c-b4df-274fb42eb986', revision: 2, title: 'Tin mới', summary: 'Nội dung mới', body: 'Chi tiết bản cập nhật', version: '', category: 'notice', pinned: false, publishedAt: '2026-10-12T00:00:00.000Z' };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('news read state', () => {
  it('persists only the article actually read and detects a later published edit', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value) });
    vi.mocked(getNews).mockResolvedValue([post, { ...post, id: 'b53debd4-129e-44d1-81c9-ac2917b9d121' }]);
    const store = new NewsStore(); store.hydrate(); await store.load(); store.markRead(post);
    const restored = new NewsStore(); restored.hydrate();
    expect(restored.get().read).toEqual({ [post.id]: 2 });
    vi.mocked(getNews).mockResolvedValue([{ ...post, revision: 3 }]); await restored.load();
    expect(restored.get().read[post.id]).toBeLessThan(restored.get().posts[0]!.revision);
  });
  it('keeps previous articles on a network failure and tolerates unavailable storage', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    vi.mocked(getNews).mockResolvedValue([post]);
    const store = new NewsStore(); store.hydrate(); await store.load(); store.markRead(post);
    vi.mocked(getNews).mockRejectedValue(new Error('Mất kết nối')); await store.load();
    expect(store.get()).toMatchObject({ posts: [post], read: { [post.id]: 2 }, error: 'Mất kết nối', loading: false });
  });
  it('deduplicates concurrent menu and page requests', async () => {
    vi.mocked(getNews).mockResolvedValue([]);
    const store = new NewsStore(); await Promise.all([store.load(), store.load(), store.load()]);
    expect(getNews).toHaveBeenCalledTimes(1);
  });
});

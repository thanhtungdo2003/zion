'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { isNewsUnread, sortNews, type NewsPost, type NewsReadState } from '@zion/shared';
import { getNews } from './api';

const READ_KEY = 'zion.news.read.v1';
interface NewsState { posts: NewsPost[]; read: NewsReadState; loading: boolean; loaded: boolean; error: string }
const INITIAL: NewsState = { posts: [], read: {}, loading: false, loaded: false, error: '' };
export class NewsStore {
  private state: NewsState = INITIAL;
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private hydrated = false;
  get = () => this.state;
  server = () => INITIAL;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(patch: Partial<NewsState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(READ_KEY) ?? '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        this.emit({ read: Object.fromEntries(Object.entries(saved).filter(([id, revision]) => /^[a-f0-9-]{36}$/.test(id) && Number.isSafeInteger(revision) && (revision as number) > 0)) });
      }
    } catch { /* Private browsing still keeps read state in memory. */ }
  }
  load = (): Promise<void> => {
    if (this.pending) return this.pending;
    this.emit({ loading: true });
    this.pending = getNews().then(posts => { this.emit({ posts: sortNews(posts), loaded: true, error: '' }); })
      .catch(error => { this.emit({ error: error instanceof Error ? error.message : 'Không tải được bản cập nhật.' }); })
      .finally(() => { this.pending = null; this.emit({ loading: false }); });
    return this.pending;
  };
  markRead(post: NewsPost) {
    this.hydrate();
    if (!isNewsUnread(post, this.state.read)) return;
    const read = { ...this.state.read, [post.id]: post.revision };
    this.emit({ read });
    try { localStorage.setItem(READ_KEY, JSON.stringify(read)); } catch { /* Keep the in-memory state. */ }
  }
  syncRead = () => { this.hydrated = false; this.hydrate(); };
}
export const newsStore = new NewsStore();

export function useNews() {
  const state = useSyncExternalStore(newsStore.subscribe, newsStore.get, newsStore.server);
  useEffect(() => {
    newsStore.hydrate(); void newsStore.load();
    const refresh = () => { if (document.visibilityState === 'visible') void newsStore.load(); };
    const sync = (event: StorageEvent) => { if (event.key === READ_KEY) newsStore.syncRead(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh); window.addEventListener('storage', sync);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('storage', sync); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return { ...state, unread: state.posts.filter(post => isNewsUnread(post, state.read)).length, reload: newsStore.load };
}

'use client';

import { useEffect, useState } from 'react';
import { isNewsUnread, NEWS_CATEGORIES } from '@zion/shared';
import { newsStore, useNews } from '@/lib/news-store';
import { LibraryHeader } from './LibraryHeader';
import { NewsArticle } from './NewsArticle';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

export function NewsPage() {
  const { posts, read, unread, loading, loaded, error, reload } = useNews();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState('all');
  const filtered = category === 'all' ? posts : posts.filter(post => post.category === category);
  const selected = filtered.find(post => post.id === selectedId) ?? filtered[0];
  useEffect(() => { if (selected) newsStore.markRead(selected); }, [selected]);
  return <main className="library-page news-page">
    <LibraryHeader active="news" />
    <section className="library-intro"><div><h1>Tin mới</h1></div><div className="library-intro-meta" title="Bài chưa đọc"><Icon name="lucide:radio-tower" /><b>{unread}</b></div></section>
    {error && <div className="library-notice" role="alert"><Icon name="lucide:wifi-off" />{error}<button className="btn" disabled={loading} onClick={() => void reload()}>Thử lại</button></div>}
    <div className="news-layout"><aside className="news-feed"><header><button className="library-icon-button" title="Làm mới bản tin" aria-label="Làm mới bản tin" disabled={loading} onClick={() => void reload()}><Icon name="lucide:refresh-cw" /></button></header><div className="news-filters" role="group" aria-label="Lọc chuyên mục">{Object.entries({ all: 'Tất cả', ...NEWS_CATEGORIES }).map(([key, label]) => <button key={key} className={category === key ? 'on' : ''} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}</div>
      {!loaded && loading && <div className="library-empty" role="status"><Spinner /></div>}
      {loaded && !filtered.length && <div className="library-empty"><Icon name="lucide:radio" /><p>0</p></div>}
      {filtered.map(post => <button key={post.id} className={`news-feed-card ${selected?.id === post.id ? 'on' : ''}`} aria-pressed={selected?.id === post.id} onClick={() => setSelectedId(post.id)}><div><span>{NEWS_CATEGORIES[post.category]}</span>{post.pinned && <Icon name="lucide:pin" />}{isNewsUnread(post, read) && <i className="news-unread-dot" role="img" aria-label="Bài chưa đọc" />}</div><h2>{post.title}</h2><p>{post.summary}</p><footer><time dateTime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString('vi-VN')}</time><b>{post.version}</b><Icon name="lucide:arrow-up-right" /></footer></button>)}
    </aside><section className="news-reading" aria-label="Nội dung bản cập nhật">{selected ? <NewsArticle post={selected} publishedAt={selected.publishedAt} /> : <div className="news-reading-empty"><Icon name="lucide:newspaper" /></div>}</section></div>
  </main>;
}

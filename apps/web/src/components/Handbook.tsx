'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { HANDBOOK_CATEGORIES, buildHandbook, type HandbookCategory, type HandbookEntry } from '@zion/shared';
import { getHandbook } from '@/lib/api';
import { itemDescription } from '@/lib/i18n';
import { LibraryHeader } from './LibraryHeader';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

const ModelPreview = dynamic(() => import('./ModelPreview'), { ssr: false, loading: () => <div className="model-preview-state"><Spinner /></div> });
export function Handbook() {
  const [entries, setEntries] = useState<HandbookEntry[]>(() => buildHandbook());
  const [category, setCategory] = useState<HandbookCategory>('monsters');
  const [selectedId, setSelectedId] = useState('monster.rotting');
  const [search, setSearch] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true; setLoading(true);
    void getHandbook().then(next => { if (alive) { setEntries(next); setError(''); } })
      .catch(() => { if (alive) setError('Ngoại tuyến'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [attempt]);
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd').replaceAll('Đ', 'D').toLocaleLowerCase('vi-VN');
  const list = useMemo(() => entries.filter(entry => entry.category === category && normalize(`${entry.title} ${entry.subtitle}`).includes(normalize(search))), [entries, category, search]);
  const selected = list.find(entry => entry.id === selectedId) ?? list[0];
  const info = HANDBOOK_CATEGORIES[category];
  return <main className="library-page handbook-page">
    <LibraryHeader active="handbook" />
    <section className="library-intro"><div><h1>Cẩm nang</h1></div><div className="library-intro-meta" title="Hồ sơ"><Icon name="lucide:book-open" /><b>{entries.length}</b></div></section>
    {error && <div className="library-notice" role="status"><Icon name="lucide:wifi-off" />{error}<button className="btn" disabled={loading} onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>}
    <div className="handbook-layout">
      <aside className="handbook-sidebar"><nav aria-label="Chủ đề cẩm nang">{(Object.keys(HANDBOOK_CATEGORIES) as HandbookCategory[]).map((key, index) => <button key={key} className={category === key ? 'on' : ''} aria-pressed={category === key} onClick={() => { setCategory(key); setSearch(''); }}><span>0{index + 1}</span><Icon name={HANDBOOK_CATEGORIES[key].icon} /><b>{HANDBOOK_CATEGORIES[key].label}</b><small>{entries.filter(entry => entry.category === key).length}</small></button>)}</nav></aside>
      <section className="handbook-collection" aria-label={`Danh sách ${info.label.toLocaleLowerCase('vi-VN')}`}><header><div><h2 title={info.intro}>{info.label}</h2></div><label className="library-search"><Icon name="lucide:search" /><input aria-label="Tìm trong cẩm nang" placeholder="Tìm tên hoặc loại…" value={search} onChange={event => setSearch(event.target.value)} /></label></header><div className="handbook-entry-list">{list.map((entry, index) => <button key={entry.id} className={selected?.id === entry.id ? 'on' : ''} aria-pressed={selected?.id === entry.id} onClick={() => setSelectedId(entry.id)}><span className="handbook-entry-number">{String(index + 1).padStart(2, '0')}</span><div><small>{entry.subtitle}</small><b>{entry.title}</b></div><Icon name={selected?.id === entry.id ? 'lucide:arrow-up-right' : info.icon} /></button>)}{!list.length && <div className="library-empty"><Icon name="lucide:search-x" /><button className="btn" onClick={() => setSearch('')}>Xóa tìm kiếm</button></div>}</div></section>
      {selected && <section className="handbook-detail" aria-label={`Hồ sơ ${selected.title}`}>
        <div className="handbook-hero"><div className="handbook-model-label"><span>{selected.subtitle}</span><Icon name="lucide:box" /></div><ModelPreview model={selected.model} title={selected.title} /></div>
        <article className="handbook-description"><h2>{selected.title}</h2><p>{selected.itemId ? itemDescription('vi', selected.itemId) : selected.description}</p></article>
        <section className="handbook-stats" aria-label="Thông tin chi tiết">{selected.stats.map(stat => <div key={stat.label}><span>{stat.label}</span><b>{stat.value}</b></div>)}</section>
        <section className="handbook-tips"><h3><Icon name="lucide:lightbulb" /> Mẹo</h3><ul>{selected.tips.map(tip => <li key={tip}>{tip}</li>)}</ul></section>
      </section>}
    </div>
  </main>;
}

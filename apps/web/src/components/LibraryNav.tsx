'use client';

import Link from 'next/link';
import { useNews } from '@/lib/news-store';
import { Icon } from './Icon';

export function LibraryNav({ active }: { active?: 'handbook' | 'news' }) {
  const { unread } = useNews();
  return <nav className="library-nav" aria-label="Khám phá ZION">
    <Link href="/handbook" className={active === 'handbook' ? 'on' : ''} aria-current={active === 'handbook' ? 'page' : undefined}><Icon name="lucide:book-open" /><span>Cẩm nang</span></Link>
    <Link href="/news" className={active === 'news' ? 'on' : ''} aria-current={active === 'news' ? 'page' : undefined}><Icon name="lucide:newspaper" /><span>Tin mới</span>{unread > 0 && <i className="news-unread-dot" role="img" aria-label={`${unread} bản cập nhật chưa đọc`} />}</Link>
  </nav>;
}

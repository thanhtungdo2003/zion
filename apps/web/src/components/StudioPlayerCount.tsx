'use client';

import { useEffect, useState } from 'react';
import { studioPlayerCounts } from '@/lib/api';
import { Icon } from './Icon';

export function StudioPlayerCount() {
  const [counts, setCounts] = useState<{ online: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await studioPlayerCounts();
        if (active) { setCounts(next); setFailed(false); }
      } catch { if (active) setFailed(true); }
      if (active) timer = setTimeout(() => { void refresh(); }, 10_000);
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  return <span className="studio-badge studio-player-count" title={failed ? 'Chưa cập nhật được số người chơi' : 'Cập nhật mỗi 10 giây'}>
    <Icon name="lucide:users" /> {failed ? 'Người chơi: mất kết nối' : counts ? `${counts.online} đang trong game · ${counts.total} tổng người chơi` : 'Đang tải số người chơi…'}
  </span>;
}

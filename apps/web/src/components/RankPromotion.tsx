'use client';

import { useEffect, useState } from 'react';
import type { HudState } from '@/game/hud-store';
import { GuidePortrait } from './Onboarding';
import { RankBadge } from './RankBadge';

export function RankPromotion({ promotion }: { promotion: HudState['promotion'] }) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [titleVisible, setTitleVisible] = useState(false);
  useEffect(() => {
    if (!promotion) return;
    setTitleVisible(true);
    const timer = setTimeout(() => setTitleVisible(false), 6500);
    const guide = setTimeout(() => setDismissed(promotion.at), 20_000);
    return () => { clearTimeout(timer); clearTimeout(guide); };
  }, [promotion]);
  if (!promotion || dismissed === promotion.at) return null;
  return <div className="rank-promotion" aria-live="polite">
    {titleVisible && <div className="rank-promotion-title"><small>THĂNG QUÂN HÀM</small><RankBadge rank={promotion.rank} title /><span>{'★'.repeat(promotion.rank.stars)}</span></div>}
    <div className="rank-guide"><GuidePortrait /><div><span className="q-kicker">HƯỚNG DẪN QUÂN VỤ</span><h3>{promotion.rank.title}</h3><p>{promotion.introduction}</p><button className="btn btn-primary" onClick={() => setDismissed(promotion.at)}>Đã rõ</button></div></div>
  </div>;
}

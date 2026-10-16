'use client';

import dynamic from 'next/dynamic';
import { LoadingBackdrop } from '@/components/LoadingBackdrop';

// The engine touches window/WebGL: never render it on the server.
const GameView = dynamic(() => import('@/components/GameView'), {
  ssr: false,
  loading: () => <LoadingBackdrop><div className="loader-row"><i className="spinner" /><span>Đang chuẩn bị trận đấu…</span></div></LoadingBackdrop>,
});

export default function PlayPage() {
  return <GameView />;
}

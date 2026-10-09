'use client';

import dynamic from 'next/dynamic';

// The engine touches window/WebGL: never render it on the server.
const GameView = dynamic(() => import('@/components/GameView'), {
  ssr: false,
  loading: () => <div className="game-root" />,
});

export default function PlayPage() {
  return <GameView />;
}

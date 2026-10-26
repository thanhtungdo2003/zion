'use client';

import dynamic from 'next/dynamic';

// WebGL, pointer lock and sound: client only.
const ShootingRange = dynamic(() => import('@/components/ShootingRange').then((m) => m.ShootingRange), { ssr: false, loading: () => <div className="range-page" /> });

export default function RangePage() {
  return <ShootingRange />;
}

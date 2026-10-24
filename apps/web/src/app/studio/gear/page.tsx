'use client';

import dynamic from 'next/dynamic';

// WebGL preview and the studio session live in the browser: client only.
const GearStudioPage = dynamic(() => import('@/components/GearStudio').then((m) => m.GearStudioPage), { ssr: false, loading: () => <div className="gs-page" /> });

export default function StudioGearPage() {
  return <GearStudioPage />;
}

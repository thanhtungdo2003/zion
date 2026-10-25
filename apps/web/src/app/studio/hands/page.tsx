'use client';

import dynamic from 'next/dynamic';

// WebGL stage and the studio session live in the browser: client only.
const HandStudioPage = dynamic(() => import('@/components/HandStudio').then((m) => m.HandStudioPage), { ssr: false, loading: () => <div className="gs-page" /> });

export default function StudioHandsPage() {
  return <HandStudioPage />;
}

'use client';

import dynamic from 'next/dynamic';

// Maps live in the browser's IndexedDB: client only.
const WorldStudio = dynamic(() => import('@/components/world-studio/WorldStudio'), { ssr: false, loading: () => <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)' }} /> });

export default function WorldStudioPage() {
  return <WorldStudio />;
}

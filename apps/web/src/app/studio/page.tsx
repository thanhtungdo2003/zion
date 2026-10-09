'use client';

import dynamic from 'next/dynamic';

// The editor reads the session from browser storage: client only.
const StudioView = dynamic(() => import('@/components/StudioView'), {
  ssr: false,
  loading: () => <div className="studio-root" />,
});

export default function StudioPage() {
  return <StudioView />;
}

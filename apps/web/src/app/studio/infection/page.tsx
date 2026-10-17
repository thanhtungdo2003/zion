'use client';

import dynamic from 'next/dynamic';

// The map editor and the studio session live in the browser: client only.
const InfectionStudio = dynamic(() => import('@/components/InfectionStudio'), {
  ssr: false,
  loading: () => <div className="ix-page" />,
});

export default function StudioInfectionPage() {
  return <InfectionStudio />;
}

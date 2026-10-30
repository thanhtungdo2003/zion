'use client';

import dynamic from 'next/dynamic';

// WebGL preview and the studio session live in the browser: client only.
const VehicleStudioPage = dynamic(() => import('@/components/VehicleStudio').then((m) => m.VehicleStudioPage), { ssr: false, loading: () => <div className="gs-page" /> });

export default function StudioVehiclesPage() {
  return <VehicleStudioPage />;
}

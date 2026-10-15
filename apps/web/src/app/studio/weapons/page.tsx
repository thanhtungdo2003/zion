'use client';

import dynamic from 'next/dynamic';

// WebGL previews and the studio session live in the browser: client only.
const WeaponManagerPage = dynamic(() => import('@/components/WeaponStudio').then((m) => m.WeaponManagerPage), {
  ssr: false,
  loading: () => <div className="ws-page" />,
});

export default function StudioWeaponsPage() {
  return <WeaponManagerPage />;
}

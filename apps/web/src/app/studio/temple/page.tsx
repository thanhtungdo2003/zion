'use client';
import dynamic from 'next/dynamic';
const TempleStudioPage = dynamic(() => import('@/components/temple/TempleStudio').then((m) => m.TempleStudioPage), { ssr: false, loading: () => <div className="gs-page" /> });
export default function StudioTemplePage() { return <TempleStudioPage />; }

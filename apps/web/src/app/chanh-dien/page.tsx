'use client';
import dynamic from 'next/dynamic';
// The Chánh Điện game screen: the hall alone, full window (OBS source, phone, TV).
const TempleView = dynamic(() => import('@/components/temple/TempleView').then((m) => m.TempleView), { ssr: false, loading: () => <div className="tp-page" /> });
export default function ChanhDienPage() { return <main className="tp-page"><TempleView /></main>; }

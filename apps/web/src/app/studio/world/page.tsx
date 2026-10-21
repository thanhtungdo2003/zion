'use client';
import dynamic from 'next/dynamic';
const WorldEditor = dynamic(() => import('@/components/WorldEditor'), { ssr: false });
export default function WorldEditorPage() { return <WorldEditor />; }

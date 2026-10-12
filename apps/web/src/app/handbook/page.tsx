import type { Metadata } from 'next';
import { Handbook } from '@/components/Handbook';
export const metadata: Metadata = { title: 'Cẩm nang đời sống — ZION', description: 'Tìm hiểu quái vật, vũ khí, trang bị, chế độ và NPC trong thế giới ZION.' };
export default function HandbookPage() { return <Handbook />; }

import type { Metadata } from 'next';
import { NewsPage } from '@/components/NewsPage';
export const metadata: Metadata = { title: 'Có gì mới? — ZION', description: 'Các bản cập nhật, sự kiện và thông báo mới nhất từ đội ngũ ZION.' };
export default function UpdatesPage() { return <NewsPage />; }

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { BrowserControls } from '@/components/BrowserControls';

export const metadata: Metadata = {
  title: 'ZION — The Last Light',
  description: 'Sinh tồn nhiều người chơi trong thế giới hậu tận thế được tạo ngẫu nhiên.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d1013',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <head><link rel="preload" href="/fonts/NotoSans-VF.ttf" as="font" type="font/ttf" crossOrigin="anonymous" /></head>
      <body><BrowserControls />{children}</body>
    </html>
  );
}

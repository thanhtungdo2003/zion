import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { BrowserControls } from '@/components/BrowserControls';
import { PwaProvider } from '@/components/PwaProvider';

export const metadata: Metadata = {
  applicationName: 'ZION',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'ZION', statusBarStyle: 'black-translucent' },
  icons: { apple: [{ url: '/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] },
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
      <head>
        <link rel="preload" href="/fonts/NotoSans-VF.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/images/loading-background-2.webp" as="image" type="image/webp" fetchPriority="high" />
      </head>
      <body><PwaProvider><BrowserControls />{children}</PwaProvider></body>
    </html>
  );
}

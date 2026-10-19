import type { MetadataRoute } from 'next';
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: 'ZION — The Last Light', short_name: 'ZION',
    description: 'Game sinh tồn nhiều người chơi trong thế giới hậu tận thế.',
    lang: 'vi', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#0d1013', theme_color: '#0d1013',
    categories: ['games'],
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

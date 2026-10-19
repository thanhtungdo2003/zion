// @ts-check
import { fileURLToPath } from 'node:url';
// The desktop build talks to the API through its own local origin (a proxy in the app).
const desktop = process.env.NEXT_PUBLIC_API_URL === 'same-origin';
const api = desktop ? 'http://127.0.0.1:*' : process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const wsOrigin = desktop ? 'ws://127.0.0.1:*' : process.env.NEXT_PUBLIC_WS_ORIGIN ?? api.replace(/^http/, 'ws');
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; eval is needed only by the dev-mode refresh runtime.
  // 'wasm-unsafe-eval' lets the browser compile the Jolt physics WebAssembly (vehicle prediction).
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' blob: ${api} ${wsOrigin}${isDev ? ' ws://localhost:3000 ws://127.0.0.1:3000' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ['@zion/shared', '@zion/physics', '@zion/assets'],
  // The desktop app ships a static export (served by the app itself); the website a Node server.
  output: desktop ? 'export' : 'standalone',
  // Its own build folder, so building the app never touches the website's build.
  ...(desktop ? { distDir: '.next-desktop' } : {}),
  // Keep the monorepo's standalone entry at apps/web/server.js on every host.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  webpack(config, { isServer, webpack }) {
    // jolt-physics probes Node built-ins (node:module) that never run in the browser.
    if (!isServer) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => { resource.request = resource.request.replace(/^node:/, ''); }));
      config.resolve.fallback = { ...config.resolve.fallback, module: false, fs: false, path: false, url: false, worker_threads: false };
    }
    return config;
  },
  ...(desktop ? { images: { unoptimized: true } } : {}),
  async headers() {
    if (desktop) return [];
    return [
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          ...(isDev || desktop ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
      {
        source: '/assets/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;

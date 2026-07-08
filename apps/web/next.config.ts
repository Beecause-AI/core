import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV === 'development';
const serverUrl = process.env.SERVER_URL ?? 'http://127.0.0.1:8080';

// Prod: static export served by Firebase Hosting, whose rewrites proxy /api/** and
// /auth/** to the Cloud Run server (same origin → first-party cookies).
// Dev: `next dev` proxies the same paths to the local Fastify server.
const nextConfig: NextConfig = dev
  ? {
      async rewrites() {
        return [
          { source: '/p/:path*', destination: '/p' },
          { source: '/api/:path*', destination: `${serverUrl}/api/:path*` },
          { source: '/auth/:path*', destination: `${serverUrl}/auth/:path*` },
        ];
      },
    }
  : { output: 'export' };

export default nextConfig;

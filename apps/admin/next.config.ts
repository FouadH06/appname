import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/core', '@app/i18n', '@app/ui-web', '@app/api', '@app/db'],
  poweredByHeader: false,
  // Dev server only: e2e tests and local phones reach it by IP rather than localhost
  allowedDevOrigins: ['127.0.0.1', ...(process.env.DEV_ORIGINS?.split(',').filter(Boolean) ?? [])],
  // Admin is never indexed or framed (Phase 3 Part 6 §7: separate origin, MFA).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;

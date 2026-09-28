import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@app/core', '@app/i18n', '@app/ui-web', '@app/api', '@app/db'],
  poweredByHeader: false,
  // Dev server only: e2e tests and local phones reach it by IP rather than localhost
  allowedDevOrigins: ['127.0.0.1', ...(process.env.DEV_ORIGINS?.split(',').filter(Boolean) ?? [])],
};

export default nextConfig;

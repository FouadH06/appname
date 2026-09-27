import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@app/core', '@app/i18n', '@app/ui-web', '@app/api', '@app/db'],
  poweredByHeader: false,
};

export default nextConfig;

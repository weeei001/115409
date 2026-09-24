import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(process.env.CAPACITOR_BUILD === '1' ? { output: 'export' as const } : {}),
};

export default nextConfig;

import type { NextConfig } from 'next';
// Keep `next dev` caches separate from production builds to prevent concurrent
// development/build runs from corrupting the active Webpack module graph.
const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
};
export default nextConfig;

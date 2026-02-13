/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployment
  // This creates a self-contained build that doesn't require node_modules
  output: 'standalone',

  // Ignore ESLint errors during production build
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Ignore TypeScript errors during production build
  typescript: {
    ignoreBuildErrors: true,
  },

  // Webpack configuration for PDF.js worker
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;

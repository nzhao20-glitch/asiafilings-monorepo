import nextEnv from '@next/env';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Load .env files from the parent directory (apps/web-platform/)
// where they're shared between frontend and backend workspaces.
const __dirname = dirname(fileURLToPath(import.meta.url));
nextEnv.loadEnvConfig(resolve(__dirname, '..'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly pass NEXT_PUBLIC_ vars to the client bundle since
  // loadEnvConfig from the parent directory doesn't trigger Next.js's
  // built-in DefinePlugin inlining for client-side code.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },

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

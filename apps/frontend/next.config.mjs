import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployments
  // This creates a minimal Node.js server in .next/standalone
  // See: https://nextjs.org/docs/app/api-reference/next-config-js/output
  output: 'standalone',

  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    if (!isServer) {
      config.resolve.alias['stream-fork'] = path.resolve(
        import.meta.dirname,
        'stubs/stream-fork.ts',
      );
    }

    // Fix for HeartbeatWorker.js - ensure worker files are treated as modules
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /HeartbeatWorker\.js$/,
      type: 'javascript/auto',
      use: [
        {
          loader: 'worker-loader',
          options: { filename: 'static/[hash].worker.js' },
        },
      ],
    });

    return config;
  },
};

export default nextConfig;

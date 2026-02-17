import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: path.resolve(import.meta.dirname, '../../'),
  },
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

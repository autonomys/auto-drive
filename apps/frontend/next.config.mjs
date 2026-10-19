import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 14's SWC minifier rewrites @scure/sr25519's `proving${'\0'}0` (reached
  // through @autonomys/auto-utils) as `proving\00`, an invalid octal escape in a
  // template literal. Terser keeps it valid.
  swcMinify: false,
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

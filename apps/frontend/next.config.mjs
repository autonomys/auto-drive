/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };

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

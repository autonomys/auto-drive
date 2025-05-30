import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
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
    return config;
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build output and caches live under .cache/ so a session revert can never
  // resurrect stale build products (see demo-projects/README.md).
  distDir: '.cache/next',
  images: {
    // The bench-owned fixture origins run on ephemeral loopback ports.
    remotePatterns: [
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;

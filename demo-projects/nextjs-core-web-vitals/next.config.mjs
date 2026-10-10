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
  // Demo convenience: opening the app without a dataset seed lands on the
  // timed seed instead of a seedless page. The benchmark always supplies a
  // seed explicitly, and sessions measure seeded URLs only.
  async redirects() {
    return [
      {
        source: '/',
        missing: [{ type: 'query', key: 'seed' }],
        destination: '/?seed=storefront-timed-1',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

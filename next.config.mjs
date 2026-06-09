/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow self-hosting as a standalone server bundle (Docker-friendly).
  output: "standalone",
  eslint: {
    // Don't fail production builds on lint; lint is run separately.
    ignoreDuringBuilds: true,
  },
  // Don't leak the framework/version to clients.
  poweredByHeader: false,
  // Baseline security headers applied to every response. The reverse proxy
  // (see docker-compose proxy profile) sets the same headers at the edge;
  // having them here means direct-to-:3000 deploys are covered too.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

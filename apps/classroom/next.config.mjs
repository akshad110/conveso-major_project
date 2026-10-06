/** @type {import('next').NextConfig} */
const frameAncestors = [
  "'self'",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://*.vercel.app",
  "https://*.onrender.com",
].join(" ");

const nextConfig = {
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors}`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

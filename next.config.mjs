// Next.js is frontend only. Every /api/* request goes to the research API (worker/), a Cloudflare
// Worker: locally `npm run api` serves it on http://127.0.0.1:8787; in production API_URL names the
// deployed Worker, e.g. https://launchradar-api.<account>.workers.dev.
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // response compression buffers chunks and would stall the streamed research log
  compress: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;

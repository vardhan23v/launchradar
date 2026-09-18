// The backend is the Python API in backend/. Next.js is frontend only: it proxies
// /api/* so the browser stays same-origin and never learns the API's address.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // response compression buffers chunks and would stall the SSE research trace
  compress: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;

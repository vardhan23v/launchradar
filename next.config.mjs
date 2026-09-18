// Next.js is frontend only. Every /api/* request goes to the Python API (backend/app):
//   - on Vercel, to the Python function in api/index.py
//   - anywhere else, to a Python server (npm run api), whose address API_URL can override
const onVercel = Boolean(process.env.VERCEL);
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // response compression buffers chunks and would stall the streamed research log
  compress: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: onVercel && !process.env.API_URL ? "/api/" : `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;

// Next.js is frontend only. Every /api/* request goes to the research API (worker/), a Cloudflare
// Worker: locally `npm run api` serves it on http://127.0.0.1:8787; in production API_URL names the
// deployed Worker, e.g. https://launchradar-api.<account>.workers.dev.
const onVercel = Boolean(process.env.VERCEL);
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

// a deployed site must never fall back to a local address or send API traffic over plain http
if (onVercel && !/^https:\/\/[^/\s]+$/.test(API_URL)) {
  throw new Error("API_URL must be set to the Worker's https:// origin (no path) in the Vercel project settings.");
}

/** Headers for every page: no framing (clickjacking), no MIME sniffing, a narrow referrer and feature policy. */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(onVercel ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // response compression buffers chunks and would stall the streamed research log
  compress: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;

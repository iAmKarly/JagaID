/** @type {import('next').NextConfig} */
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "";

// CSP is set per-request by src/middleware.ts (nonce-based). Everything else
// is fine to ship as a static header on every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const corsHeaders = ALLOWED_ORIGIN
  ? [
      { key: "Access-Control-Allow-Origin", value: ALLOWED_ORIGIN },
      { key: "Access-Control-Allow-Methods", value: "GET, POST, DELETE, OPTIONS" },
      {
        key: "Access-Control-Allow-Headers",
        value: "Content-Type, x-admin-key, x-e2e-key",
      },
      { key: "Vary", value: "Origin" },
    ]
  : [];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    const rules = [{ source: "/(.*)", headers: securityHeaders }];
    if (corsHeaders.length > 0) {
      rules.push({ source: "/api/:path*", headers: corsHeaders });
    }
    return rules;
  },
};

module.exports = nextConfig;

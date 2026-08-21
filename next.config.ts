import type { NextConfig } from "next";

const ENFORCED_CSP = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests",
].join("; ");

// The Sites build adds these in worker/index.ts. Native Next.js deployments
// (including Netlify) bypass that Worker, so they must add them here instead.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: ENFORCED_CSP },
  { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "0" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;

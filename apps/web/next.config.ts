import type { NextConfig } from "next";

/**
 * Security headers on every page and API response. frame-ancestors / X-Frame-Options stop other sites showing the
 * app inside a frame (clickjacking); the app may still frame itself. A full script policy (Content-Security-Policy
 * script-src) would need nonces because of the inline theme script in app/layout.tsx, so only framing is limited here.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

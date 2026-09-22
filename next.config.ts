import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Security headers applied to every response. The CSP is deliberately scoped to
// the high-value, low-breakage directives: it locks down plugins (object-src),
// base-uri, and framing (frame-ancestors) WITHOUT a default-src/script-src,
// which would otherwise block the many external origins the app legitimately
// uses (Supabase signed URLs, Sanity CDN, Stripe, GTM, web-push). A full
// nonce-based script-src CSP can be layered on later behind testing.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"].join(
      "; ",
    ),
  },
];

// pdfium.wasm is read from node_modules at runtime by the AI-parse raster
// fallback (features/scripts/pdf-raster.ts): the run route and the two pages
// whose server actions split a book. Tracing it explicitly is what ships it
// with those functions on Vercel.
const PDFIUM_WASM = ["./node_modules/@hyzyla/pdfium/dist/pdfium.wasm"];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "64mb",
    },
    proxyClientMaxBodySize: "64mb",
  },
  // Load pdfium's Node build as-is (emscripten glue doesn't survive bundling).
  serverExternalPackages: ["@hyzyla/pdfium"],
  outputFileTracingIncludes: {
    "/api/scripts/[parseId]/run": PDFIUM_WASM,
    "/productions/[slug]/script/ai": PDFIUM_WASM,
    "/focus/[slug]": PDFIUM_WASM,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The help center briefly shipped at /docs before moving to /help.
  async redirects() {
    return [
      { source: "/docs", destination: "/help", permanent: true },
      { source: "/docs/:path*", destination: "/help/:path*", permanent: true },
    ];
  },
};

export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      disableLogger: true,
    })
  : nextConfig;

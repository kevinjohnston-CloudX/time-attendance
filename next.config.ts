import type { NextConfig } from "next";

/**
 * Server Actions carry their own CSRF check: Next compares the browser's
 * `Origin` against the `Host` it was reached on, and aborts the action if they
 * disagree.
 *
 * <p>A VS Code dev tunnel breaks that comparison without anything being wrong.
 * The page is opened on `localhost:3000`, so the browser sends that as Origin,
 * but the tunnel rewrites `x-forwarded-host` to its public hostname on the way
 * through — so every Server Action posted over a shared tunnel fails with
 * "Invalid Server Actions request", whatever the action was.
 *
 * <p>Scoped to development on purpose. This is the check that stops another
 * site posting actions with a signed-in user's cookies, and the deployment has
 * no tunnel in front of it, so production keeps it intact.
 */
const devTunnelOrigins = ["localhost:3000", "*.devtunnels.ms"];

/**
 * Where the app is opened locally. Next 16.3 refuses the dev server's live
 * connection (and with it the page ever finishing loading) from any address
 * but localhost unless it is listed here, and we open CloudTime on
 * 127.0.0.1 so its sign-in cookie does not clash with the ticketing copy on
 * localhost:3100 (see CLAUDE.md). Development only; production ignores it.
 */
const localDevHosts = ["127.0.0.1"];

/**
 * Loaded from node_modules as they are, never bundled. pdfkit (under pdfmake)
 * reads its built-in font files from beside its own code; bundled, that path
 * became /ROOT/node_modules/... and every report PDF failed with ENOENT on
 * Helvetica-Bold.afm. Found Oct 22, 2026: the download and the scheduled
 * email both make their PDF here.
 */
const unbundled = ["pdfmake", "pdfkit"];

/**
 * Security headers on every response (security audit 2026-11, M3).
 *
 * <p>Enforced now: no other site may show CloudTime inside a frame, where a
 * hidden button can be lined up under someone's click (approve, reset a
 * password). CloudTime may still frame itself, which the page sweeps use.
 * Browsers must not guess file types, links carry only the address's origin
 * to other sites, and the camera (photo retakes) is CloudTime's alone.
 *
 * <p>The content security policy is report only for now: the browser logs
 * what it would block in the console and blocks nothing. Once a release has
 * run clean it moves to the enforced header. Photos come from S3 signed
 * links; documents open on Supabase by redirect, which needs no entry here.
 */
const isDev = process.env.NODE_ENV === "development";
const reportOnlyPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.amazonaws.com https://*.supabase.co",
  "font-src 'self' data:",
  `connect-src 'self' https://*.amazonaws.com https://*.supabase.co${isDev ? " ws: wss:" : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyPolicy },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevHosts,
  serverExternalPackages: unbundled,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
      ...(process.env.NODE_ENV === "development"
        ? { allowedOrigins: devTunnelOrigins }
        : {}),
    },
  },
};

export default nextConfig;

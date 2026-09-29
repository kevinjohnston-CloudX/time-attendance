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

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevHosts,
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

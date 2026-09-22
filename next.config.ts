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

const nextConfig: NextConfig = {
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

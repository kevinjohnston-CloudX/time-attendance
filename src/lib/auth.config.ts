import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";
import { REQUEST_PATH_HEADER } from "@/lib/constants";
import { CLASSIC_PREFIX, DESIGN_COOKIE, designFromCookie, safeNext } from "@/lib/design-switch";

/**
 * Edge-safe auth config — no Prisma, no bcrypt, no Node.js-only modules.
 * Used by middleware for route protection.
 */
/**
 * Local only: CloudTime's own cookie names. The ticketing app runs on this
 * machine too, on another port of localhost, and uses the same auth library
 * with the same default names. Browsers share cookies across ports, so each
 * sign-in overwrote the other's and both kept signing the user out. Production
 * keeps the defaults, so a deploy signs nobody out.
 */
const localCookie = (name: string, httpOnly = true) => ({
  name: `cloudtime.${name}`,
  options: { httpOnly, sameSite: "lax" as const, path: "/", secure: false },
});
const localCookies =
  process.env.NODE_ENV === "production"
    ? undefined
    : {
        sessionToken: localCookie("session-token"),
        callbackUrl: localCookie("callback-url"),
        csrfToken: localCookie("csrf-token"),
        pkceCodeVerifier: localCookie("pkce.code_verifier"),
        state: localCookie("state"),
        nonce: localCookie("nonce"),
      };

/**
 * Which addresses the classic design answers. Everything a person opens as a
 * page, except the API, the super admin area (the classic design has none)
 * and "/", which only redirects.
 */
function classicServes(pathname: string): boolean {
  return pathname !== "/" && !pathname.startsWith("/api/") && !pathname.startsWith("/super-admin");
}

/**
 * The response for a request that is allowed through: served from the
 * classic folder when this browser's design is Classic, at the same address,
 * else passed on. `headers` carries the portal's request path header.
 */
function serve(request: Request & { nextUrl: URL; cookies: { get(name: string): { value: string } | undefined } }, headers?: Headers) {
  const { nextUrl } = request;
  const init = headers ? { request: { headers } } : undefined;
  if (classicServes(nextUrl.pathname) && designFromCookie(request.cookies.get(DESIGN_COOKIE)?.value) === "classic") {
    const url = new URL(`${CLASSIC_PREFIX}${nextUrl.pathname}${nextUrl.search}`, nextUrl);
    return NextResponse.rewrite(url, init);
  }
  return headers ? NextResponse.next(init) : true;
}

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  cookies: localCookies,
  callbacks: {
    // The proxy builds its session from THIS config alone, so without a
    // session callback here `auth.user.role` is undefined in `authorized`
    // below. A super admin then looks like a regular user: the proxy sends
    // them from /super-admin to /dashboard, whose layout sends them back to
    // /super-admin, and the browser gives up after a few dozen hops.
    // The richer session callback in auth.ts replaces this one everywhere
    // except the proxy, which is exactly where it was missing.
    session({ session, token }) {
      if (token && session.user) {
        session.user.role = token.role as string;
      }
      return session;
    },
    authorized({ auth, request }) {
      const { nextUrl } = request;

      // The classic folder is never opened by its own address: it is served
      // at the plain one (see serve above), so a typed /classic/... goes there.
      if (nextUrl.pathname === CLASSIC_PREFIX || nextUrl.pathname.startsWith(`${CLASSIC_PREFIX}/`)) {
        return Response.redirect(new URL(`${safeNext(nextUrl.pathname)}${nextUrl.search}`, nextUrl));
      }
      const isLoggedIn = !!auth?.user;
      const isSuperAdmin = auth?.user?.role === "SUPER_ADMIN";
      const isOnSuperAdmin = nextUrl.pathname.startsWith("/super-admin");
      const isOnPortal = !nextUrl.pathname.startsWith("/login") &&
        !nextUrl.pathname.startsWith("/forgot-password") &&
        !nextUrl.pathname.startsWith("/setup-password") &&
        !nextUrl.pathname.startsWith("/change-password") &&
        !nextUrl.pathname.startsWith("/api/auth") &&
        !nextUrl.pathname.startsWith("/api/timeclock") &&
        !nextUrl.pathname.startsWith("/api/cron") &&
        // The WMS bridge is a process on a VM, not a browser session. It
        // authenticates with the BRIDGE_SECRET bearer token in bridgeAuthed;
        // without this exemption the session middleware 307s it to /login and
        // it receives an HTML page where it expects JSON.
        !nextUrl.pathname.startsWith("/api/bridge") &&
        !nextUrl.pathname.startsWith("/api/mobile") &&
        !nextUrl.pathname.startsWith("/api/external");

      // Super-admin routes: require SUPER_ADMIN role
      if (isOnSuperAdmin) {
        if (isLoggedIn && isSuperAdmin) return true;
        if (isLoggedIn) return Response.redirect(new URL("/dashboard", nextUrl));
        return false; // redirect to /login
      }

      if (isOnPortal) {
        if (!isLoggedIn) return false; // redirect to /login
        // Allowed through, carrying the address it is for. Server components
        // cannot read the path, and the portal layout needs it to hold a role
        // limited to Live Attendance on that page. set() replaces anything the
        // browser sent under the same name.
        const headers = new Headers(request.headers);
        headers.set(REQUEST_PATH_HEADER, nextUrl.pathname);
        return serve(request, headers);
      } else if (isLoggedIn && (
        nextUrl.pathname === "/login" ||
        nextUrl.pathname === "/forgot-password"
      )) {
        const target = isSuperAdmin ? "/super-admin" : "/dashboard";
        return Response.redirect(new URL(target, nextUrl));
      }
      // Sign in and the password screens follow this browser's last design.
      return serve(request);
    },
  },
  providers: [],
} satisfies NextAuthConfig;

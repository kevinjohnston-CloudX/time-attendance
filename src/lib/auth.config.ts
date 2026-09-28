import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";
import { REQUEST_PATH_HEADER } from "@/lib/constants";

/**
 * Edge-safe auth config — no Prisma, no bcrypt, no Node.js-only modules.
 * Used by middleware for route protection.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
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
        return NextResponse.next({ request: { headers } });
      } else if (isLoggedIn && (
        nextUrl.pathname === "/login" ||
        nextUrl.pathname === "/forgot-password"
      )) {
        const target = isSuperAdmin ? "/super-admin" : "/dashboard";
        return Response.redirect(new URL(target, nextUrl));
      }
      return true;
    },
  },
  providers: [],
} satisfies NextAuthConfig;

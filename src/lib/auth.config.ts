import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";
import { REQUEST_PATH_HEADER } from "@/lib/constants";

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
 * How long a sign in lasts, from the moment it happened: a working day. Every
 * request re-signs the session cookie with a fresh issue time and expiry, so
 * neither can say when somebody signed in; signedInAt in the token does, and
 * no click ever moves it. The proxy and the full check in auth.ts both end a
 * session past this, so a sign in never outlives the shift by being used.
 */
export const SIGN_IN_MS = 12 * 60 * 60 * 1000;

/**
 * Where a page sends someone whose session the full check in auth.ts has just
 * ended (password reset, company switched off, login removed). The proxy does
 * not read the database, so it still sees a valid cookie and would bounce
 * /login straight back to the page, which bounced to /login: a redirect loop.
 * With this flag the proxy clears the cookie and shows the sign in page.
 */
export const SESSION_ENDED_HREF = "/login?ended=1";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  cookies: localCookies,
  // The proxy re-signs the cookie on every request from THIS config. Without
  // the same lifetime here it re-signed it for the library's default 30 days.
  session: { strategy: "jwt", maxAge: SIGN_IN_MS / 1000 },
  callbacks: {
    // Edge-safe: no database. A token from before signedInAt existed is
    // stamped on first sight, which gives it one more working day.
    jwt({ token }) {
      if (typeof token.signedInAt !== "number") token.signedInAt = Date.now();
      if (Date.now() - token.signedInAt > SIGN_IN_MS) return null;
      return token;
    },
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

      // The mobile app's API is off until the app is being built: its checks
      // are weaker than the web's (the built-in role only, no forced password
      // change, refresh tokens stored readable) and nobody uses it. Set
      // MOBILE_API_ENABLED=true to open it again, once those are fixed.
      if ((nextUrl.pathname === "/api/mobile" || nextUrl.pathname.startsWith("/api/mobile/")) && process.env.MOBILE_API_ENABLED !== "true") {
        return Response.json({ success: false, error: "The mobile app is not available." }, { status: 404 });
      }
      const isLoggedIn = !!auth?.user;
      const isSuperAdmin = auth?.user?.role === "SUPER_ADMIN";
      const isOnSuperAdmin = nextUrl.pathname.startsWith("/super-admin");
      const isOnPortal = !nextUrl.pathname.startsWith("/login") &&
        !nextUrl.pathname.startsWith("/forgot-password") &&
        !nextUrl.pathname.startsWith("/setup-password") &&
        !nextUrl.pathname.startsWith("/change-password") &&
        // Public: the stores and anyone not signed in must be able to read it.
        nextUrl.pathname !== "/privacy" &&
        !nextUrl.pathname.startsWith("/api/auth") &&
        !nextUrl.pathname.startsWith("/api/timeclock") &&
        !nextUrl.pathname.startsWith("/api/cron") &&
        // The WMS bridge is a process on a VM, not a browser session. It
        // authenticates with the BRIDGE_SECRET bearer token in bridgeAuthed;
        // without this exemption the session middleware 307s it to /login and
        // it receives an HTML page where it expects JSON.
        !nextUrl.pathname.startsWith("/api/bridge") &&
        !nextUrl.pathname.startsWith("/api/mobile") &&
        // Sends a signed out browser to /login itself, carrying the app's
        // challenge, which the default redirect would drop.
        !nextUrl.pathname.startsWith("/api/app-signin") &&
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
      } else if (isLoggedIn && nextUrl.pathname === "/login" && nextUrl.searchParams.get("ended") === "1") {
        const res = NextResponse.next();
        for (const c of request.cookies.getAll()) {
          if (c.name.includes("session-token")) res.cookies.delete(c.name);
        }
        return res;
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

import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config — no Prisma, no bcrypt, no Node.js-only modules.
 * Used by middleware for route protection.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isSuperAdmin = auth?.user?.role === "SUPER_ADMIN";
      const isOnSuperAdmin = nextUrl.pathname.startsWith("/super-admin");
      const isOnPortal = !nextUrl.pathname.startsWith("/login") &&
        !nextUrl.pathname.startsWith("/forgot-password") &&
        !nextUrl.pathname.startsWith("/api/auth") &&
        !nextUrl.pathname.startsWith("/api/timeclock") &&
        !nextUrl.pathname.startsWith("/api/cron") &&
        !nextUrl.pathname.startsWith("/api/mobile");

      // Super-admin routes: require SUPER_ADMIN role
      if (isOnSuperAdmin) {
        if (isLoggedIn && isSuperAdmin) return true;
        if (isLoggedIn) return Response.redirect(new URL("/dashboard", nextUrl));
        return false; // redirect to /login
      }

      if (isOnPortal) {
        if (isLoggedIn) return true;
        return false; // redirect to /login
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

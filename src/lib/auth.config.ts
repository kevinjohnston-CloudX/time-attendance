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
      const isOnPortal = !nextUrl.pathname.startsWith("/login") &&
        !nextUrl.pathname.startsWith("/forgot-password") &&
        !nextUrl.pathname.startsWith("/api/auth");

      if (isOnPortal) {
        if (isLoggedIn) return true;
        return false; // redirect to /login
      } else if (isLoggedIn && (
        nextUrl.pathname === "/login" ||
        nextUrl.pathname === "/forgot-password"
      )) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.employeeId = (user as { employeeId?: string }).employeeId;
      }
      return token;
    },
    session({ session, token }) {
      if (token) {
        session.user.role = token.role as string;
        session.user.employeeId = token.employeeId as string | undefined;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;

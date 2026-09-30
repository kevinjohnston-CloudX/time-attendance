import NextAuth from "next-auth";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

// Called inline, auth(request, event), exactly as `export default auth` ran it.
// Its types only describe the wrapper form.
const authProxy = auth as unknown as NextMiddleware;

/**
 * Next.js 16 proxy convention (replaces middleware.ts).
 *
 * <p>The sign-in library hands auth.config's callback a copy of the request
 * with its address swapped for AUTH_URL's, so a rewrite made there (the
 * classic design) names AUTH_URL's host. Opened under any other name
 * (localhost for 127.0.0.1, a second domain, a second local server), Next
 * would fetch that host as an outside site instead of serving the page. A
 * rewrite always means this server, so it is pointed back at the address the
 * request actually came to.
 */
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const res = await authProxy(request, event);
  const rewrite = res?.headers.get("x-middleware-rewrite");
  if (res && rewrite) {
    const to = new URL(rewrite);
    if (to.origin !== request.nextUrl.origin) {
      res.headers.set("x-middleware-rewrite", new URL(`${to.pathname}${to.search}`, request.nextUrl).href);
    }
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

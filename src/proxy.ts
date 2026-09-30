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
 *
 * <p>A redirect within this site goes out as a plain path. Next writes
 * 127.0.0.1 as "localhost" whenever it builds a full address, so a full one
 * sent a browser on 127.0.0.1 to localhost, where it is not signed in. A path
 * keeps the browser on the name it used. A redirect to another site, such as
 * AUTH_URL's canonical host, is left alone.
 */
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const res = await authProxy(request, event);
  if (!res) return res;
  const rewrite = res.headers.get("x-middleware-rewrite");
  if (rewrite) {
    const to = new URL(rewrite);
    if (to.origin !== request.nextUrl.origin) {
      res.headers.set("x-middleware-rewrite", new URL(`${to.pathname}${to.search}`, request.nextUrl).href);
    }
  }
  const location = res.headers.get("location");
  if (location && res.status >= 300 && res.status < 400) {
    const to = new URL(location, request.nextUrl);
    if (to.origin === request.nextUrl.origin) res.headers.set("location", `${to.pathname}${to.search}${to.hash}`);
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

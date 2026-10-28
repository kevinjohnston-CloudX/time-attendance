import NextAuth from "next-auth";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

// Called inline, auth(request, event), exactly as `export default auth` ran it.
// Its types only describe the wrapper form.
const authProxy = auth as unknown as NextMiddleware;

/** Next.js 16 proxy convention (replaces middleware.ts): sign in and route checks, from auth.config. */
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  return authProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

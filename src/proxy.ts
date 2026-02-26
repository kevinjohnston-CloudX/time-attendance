import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

// Next.js 16 proxy convention — replaces middleware.ts
export default auth;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

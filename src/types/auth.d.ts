import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      role: string;
      employeeId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    employeeId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role?: string;
    employeeId?: string;
  }
}

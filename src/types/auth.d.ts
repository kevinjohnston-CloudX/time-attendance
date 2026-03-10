import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      role: string;
      employeeId?: string;
      tenantId?: string | null;
      customRoleId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    employeeId?: string;
    tenantId?: string | null;
    customRoleId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role?: string;
    employeeId?: string;
    tenantId?: string | null;
    customRoleId?: string;
  }
}

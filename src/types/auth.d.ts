import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      role: string;
      employeeId?: string;
      tenantId?: string | null;
      customRoleId?: string;
      canViewAs?: boolean;
      mustChangePassword?: boolean;
      /** A fresh value each time someone signs in; the same until they sign out. */
      signInId?: string;
      /** The employee record is active, read fresh on every request. */
      isActive?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    employeeId?: string;
    tenantId?: string | null;
    customRoleId?: string;
    canViewAs?: boolean;
    mustChangePassword?: boolean;
    isActive?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    signInId?: string;
    /** When this sign in happened, in ms. Set once; a click never renews it. */
    signedInAt?: number;
    role?: string;
    employeeId?: string;
    tenantId?: string | null;
    customRoleId?: string;
    canViewAs?: boolean;
    mustChangePassword?: boolean;
    isActive?: boolean;
  }
}

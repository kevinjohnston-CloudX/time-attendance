import NextAuth, { CredentialsSignin } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { liveIdentity } from "@/lib/rbac/identity";
import { clientAddress, isLockedOut, recordFailedLogin } from "@/lib/login-limit";
import { findLoginUserId } from "@/lib/login-lookup";

/** Too many wrong passwords: the sign-in page says to wait rather than "wrong password". */
class LockedOut extends CredentialsSignin {
  code = "locked";
}

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const allowedDomains = (process.env.GOOGLE_ALLOWED_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  // A working day, not the 30 day default: a sign-in left open on a shared
  // warehouse computer should not outlive the shift.
  session: { strategy: "jwt", maxAge: 12 * 60 * 60, updateAge: 60 * 60 },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Always show Google's account chooser. Without this, Google silently
      // reuses whichever account Chrome is signed into, and a person with
      // several Google accounts has no way to pick their work one.
      authorization: { params: { prompt: "select_account" } },
    }),
    // Kept for super-admin and emergency access only
    Credentials({
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        // Email, or username for super-admin accounts, ignoring capitals
        const userId = await findLoginUserId(parsed.data.username, { email: true, username: true });
        const user = userId
          ? await db.user.findUnique({
              where: { id: userId },
              include: { employee: { include: { customRole: { select: { canViewAs: true } } } } },
            })
          : null;

        if (!user?.passwordHash) return null;

        // Checked before the password, so a locked account says nothing
        // about whether the guess was right.
        const address = clientAddress(request?.headers);
        if (await isLockedOut(user.id, address)) throw new LockedOut();

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) {
          await recordFailedLogin(user.id, user.employee?.tenantId, address, "web");
          return null;
        }

        if (user.isSuperAdmin) {
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: "SUPER_ADMIN",
            employeeId: undefined,
            tenantId: null,
            mustChangePassword: false,
          };
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.employee?.role ?? "EMPLOYEE",
          employeeId: user.employee?.id ?? undefined,
          tenantId: user.employee?.tenantId ?? null,
          customRoleId: user.employee?.customRoleId ?? undefined,
          canViewAs: user.employee?.customRole?.canViewAs ?? false,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        const email = profile?.email ?? "";
        const domain = email.split("@")[1]?.toLowerCase() ?? "";
        if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
          return false;
        }
        // Only allow Google sign-in for users the admin has already registered,
        // ignoring capitals: Google sends the address lowercase, the record may not be.
        const existingId = await findLoginUserId(email, { email: true });
        if (!existingId) return false;

        // If no Account row exists yet, create it now so NextAuth doesn't
        // throw OAuthAccountNotLinked for users provisioned outside OAuth
        const linked = await db.account.findFirst({
          where: { userId: existingId, provider: "google" },
        });
        if (!linked && account.providerAccountId) {
          await db.account.create({
            data: {
              userId: existingId,
              type: "oauth",
              provider: "google",
              providerAccountId: account.providerAccountId,
              access_token: account.access_token,
              refresh_token: account.refresh_token,
              expires_at: account.expires_at,
              token_type: account.token_type,
              scope: account.scope,
              id_token: account.id_token,
            },
          });
        }
      }
      return true;
    },

    async jwt({ token, user, account }) {
      if (user) {
        // Stamped once per sign in and kept until sign out, so a screen can
        // tell "just signed in" from "still in the same session" (the design
        // notice opens again after every sign in).
        token.signInId = crypto.randomUUID();
        if (account?.provider === "google" || !(user as { role?: string }).role) {
          // Google sign-in: look up employee from DB
          const fullUser = await db.user.findUnique({
            where: { id: user.id! },
            include: { employee: { include: { customRole: { select: { canViewAs: true } } } } },
          });
          if (fullUser?.isSuperAdmin) {
            token.role = "SUPER_ADMIN";
            token.employeeId = undefined;
            token.tenantId = null;
            token.canViewAs = false;
            token.mustChangePassword = false;
          } else {
            token.role = fullUser?.employee?.role ?? "EMPLOYEE";
            token.employeeId = fullUser?.employee?.id ?? undefined;
            token.tenantId = fullUser?.employee?.tenantId ?? null;
            token.customRoleId = fullUser?.employee?.customRoleId ?? undefined;
            token.canViewAs = fullUser?.employee?.customRole?.canViewAs ?? false;
            token.mustChangePassword = fullUser?.mustChangePassword ?? false;
          }
        } else {
          // Credentials: role already stamped by authorize()
          token.role = (user as { role?: string }).role;
          token.employeeId = (user as { employeeId?: string }).employeeId;
          token.tenantId = (user as { tenantId?: string | null }).tenantId;
          token.customRoleId = (user as { customRoleId?: string }).customRoleId;
          token.canViewAs = (user as { canViewAs?: boolean }).canViewAs ?? false;
          token.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
        }
      }
      // Every request, not only at sign in: the role, company and status in
      // the token are replaced with what the database says now, so a person
      // demoted, moved or deactivated is treated that way on their next
      // click rather than when their session runs out. A person whose login
      // no longer exists is signed out.
      if (token.sub) {
        const live = await liveIdentity(token.sub);
        if (!live) return null;
        token.role = live.role;
        token.employeeId = live.employeeId ?? undefined;
        token.tenantId = live.tenantId;
        token.customRoleId = live.customRoleId ?? undefined;
        token.canViewAs = live.canViewAs;
        token.isActive = live.isActive;
        token.mustChangePassword = live.mustChangePassword;
      }
      return token;
    },

    session({ session, token }) {
      if (token) {
        if (token.sub) session.user.id = token.sub;
        session.user.role = token.role as string;
        session.user.employeeId = token.employeeId as string | undefined;
        session.user.tenantId = token.tenantId as string | null | undefined;
        session.user.customRoleId = token.customRoleId as string | undefined;
        session.user.canViewAs = token.canViewAs as boolean | undefined ?? false;
        session.user.mustChangePassword = token.mustChangePassword as boolean | undefined ?? false;
        session.user.signInId = token.signInId as string | undefined;
        session.user.isActive = token.isActive as boolean | undefined ?? true;
      }
      return session;
    },
  },
});

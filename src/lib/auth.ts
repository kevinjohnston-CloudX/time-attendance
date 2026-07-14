import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";

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
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    // Kept for super-admin and emergency access only
    Credentials({
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await db.user.findUnique({
          where: { username: parsed.data.username.toLowerCase() },
          include: { employee: true },
        });

        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        if (user.isSuperAdmin) {
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: "SUPER_ADMIN",
            employeeId: undefined,
            tenantId: null,
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
        // Only allow Google sign-in for users the admin has already registered
        const existing = await db.user.findUnique({ where: { email } });
        if (!existing) return false;

        // If no Account row exists yet, create it now so NextAuth doesn't
        // throw OAuthAccountNotLinked for users provisioned outside OAuth
        const linked = await db.account.findFirst({
          where: { userId: existing.id, provider: "google" },
        });
        if (!linked && account.providerAccountId) {
          await db.account.create({
            data: {
              userId: existing.id,
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
        if (account?.provider === "google" || !(user as { role?: string }).role) {
          // Google sign-in: look up employee from DB
          const fullUser = await db.user.findUnique({
            where: { id: user.id! },
            include: { employee: true },
          });
          if (fullUser?.isSuperAdmin) {
            token.role = "SUPER_ADMIN";
            token.employeeId = undefined;
            token.tenantId = null;
          } else {
            token.role = fullUser?.employee?.role ?? "EMPLOYEE";
            token.employeeId = fullUser?.employee?.id ?? undefined;
            token.tenantId = fullUser?.employee?.tenantId ?? null;
            token.customRoleId = fullUser?.employee?.customRoleId ?? undefined;
          }
        } else {
          // Credentials: role already stamped by authorize()
          token.role = (user as { role?: string }).role;
          token.employeeId = (user as { employeeId?: string }).employeeId;
          token.tenantId = (user as { tenantId?: string | null }).tenantId;
          token.customRoleId = (user as { customRoleId?: string }).customRoleId;
        }
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
      }
      return session;
    },
  },
});

import NextAuth, { CredentialsSignin } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { isClientBadge } from "@/lib/utils/client-badge";
import { authConfig, SIGN_IN_MS } from "@/lib/auth.config";
import { liveIdentity } from "@/lib/rbac/identity";
import { DUMMY_PASSWORD_HASH, clientAddress, isLockedOut, loginKey, recordFailedLogin } from "@/lib/login-limit";
import { findLoginUserId } from "@/lib/login-lookup";
import { redeemAppSigninCode } from "@/lib/app-signin";
import { mailAddress } from "@/lib/login-email";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { cookies } from "next/headers";
import { MICROSOFT_PROVIDER, microsoftAddresses, microsoftIssuer, microsoftSignInOffered, signInRefused } from "@/lib/microsoft-signin";
import { microsoftSignIn } from "@/lib/microsoft-signin.server";

/**
 * The company a super admin has entered, from its cookie. Null when there is
 * none or the cookie cannot be read where this runs.
 */
async function enteredCompany(): Promise<string | null> {
  try {
    return (await cookies()).get(SUPER_ADMIN_TENANT_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

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
  session: { strategy: "jwt", maxAge: SIGN_IN_MS / 1000, updateAge: 60 * 60 },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Always show Google's account chooser. Without this, Google silently
      // reuses whichever account Chrome is signed into, and a person with
      // several Google accounts has no way to pick their work one.
      authorization: { params: { prompt: "select_account" } },
    }),
    // Microsoft, beside Google: loaded only once its keys are set, and the
    // sign in page offers the button only then (lib/microsoft-signin.ts).
    ...(microsoftSignInOffered()
      ? [
          MicrosoftEntraId({
            clientId: process.env.AZURE_AD_CLIENT_ID!,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
            issuer: microsoftIssuer(),
            // The account chooser every time, as for Google: a browser signed
            // in to a personal Microsoft account would otherwise reuse it.
            // Only the name and address are asked for, so the consent screen
            // asks for nothing more (no profile photo, no directory read).
            authorization: { params: { scope: "openid profile email", prompt: "select_account" } },
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name ?? null,
                email: microsoftAddresses(profile)?.[0] ?? null,
                image: null,
              };
            },
          }),
        ]
      : []),
    // Kept for super-admin and emergency access only
    Credentials({
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        // Either email (work or personal), or username for super-admin accounts, ignoring capitals
        const userId = await findLoginUserId(parsed.data.username, { email: true, username: true });
        const user = userId
          ? await db.user.findUnique({
              where: { id: userId },
              include: { employee: { include: { customRole: { select: { canViewAs: true } } } } },
            })
          : null;

        // An email with no password login goes through the same steps as a
        // real one, the lock and the password check included, so neither the
        // time taken nor "too many attempts" tells the two apart.
        const key = loginKey(user?.passwordHash ? user.id : null, parsed.data.username);

        // Checked before the password, so a locked account says nothing
        // about whether the guess was right.
        const address = clientAddress(request?.headers);
        if (await isLockedOut(key, address)) throw new LockedOut();

        const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!user?.passwordHash || !valid) {
          await recordFailedLogin(key, user?.employee?.tenantId, address, "web");
          return null;
        }
        // A visitor holds a badge for the security gate and never signs in
        // (client-badge.ts), even if an email and password were added later.
        if (isClientBadge(user.employee?.wmsId)) return null;

        if (user.isSuperAdmin) {
          return {
            id: user.id,
            name: user.name,
            email: mailAddress(user),
            role: "SUPER_ADMIN",
            employeeId: undefined,
            tenantId: null,
            mustChangePassword: false,
          };
        }

        return {
          id: user.id,
          name: user.name,
          email: mailAddress(user),
          role: user.employee?.role ?? "EMPLOYEE",
          employeeId: user.employee?.id ?? undefined,
          tenantId: user.employee?.tenantId ?? null,
          customRoleId: user.employee?.customRoleId ?? undefined,
          canViewAs: user.employee?.customRole?.canViewAs ?? false,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
    // The phone app, after the person signed in in the phone's own browser
    // (lib/app-signin.ts). Returned without a role, so jwt() below reads the
    // person from the database exactly as it does for Google.
    Credentials({
      id: "app-signin",
      credentials: { code: {}, verifier: {} },
      async authorize(credentials) {
        const userId = redeemAppSigninCode(credentials?.code, credentials?.verifier);
        if (!userId) return null;
        const user = await db.user.findUnique({ where: { id: userId }, include: { employee: { select: { wmsId: true } } } });
        if (!user || isClientBadge(user.employee?.wmsId)) return null;
        return { id: user.id, name: user.name, email: mailAddress(user) };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        // Only an address Google has confirmed belongs to the account signs
        // someone in by it, as CXT checks (security audit 2026-11).
        if ((profile as { email_verified?: boolean } | undefined)?.email_verified !== true) return signInRefused("Refused", "google");
        const email = profile?.email ?? "";
        const domain = email.split("@")[1]?.toLowerCase() ?? "";
        if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
          return signInRefused("Refused", "google");
        }
        // Only allow Google sign-in for users the admin has already registered,
        // by either of their two emails, ignoring capitals: Google sends the
        // address lowercase, the record may not be.
        const existingId = await findLoginUserId(email, { email: true });
        if (!existingId) return signInRefused("NotSetUp", "google");
        // A visitor never signs in (client-badge.ts).
        const visitor = await db.employee.findFirst({ where: { userId: existingId }, select: { wmsId: true } });
        if (isClientBadge(visitor?.wmsId)) return signInRefused("Refused", "google");

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

      if (account?.provider === MICROSOFT_PROVIDER) {
        // Only a person HR registered, matched safely, and each Microsoft
        // account linked to one person (lib/microsoft-signin.server.ts).
        const refused = await microsoftSignIn(profile, account);
        if (refused) return refused;
      }
      return true;
    },

    async jwt({ token, user, account }) {
      if (user) {
        // Stamped once per sign in and kept until sign out, so a screen can
        // tell "just signed in" from "still in the same session" (the design
        // notice opens again after every sign in).
        token.signInId = crypto.randomUUID();
        token.signedInAt = Date.now();
        if (account?.provider === "google" || account?.provider === MICROSOFT_PROVIDER || !(user as { role?: string }).role) {
          // Google or Microsoft sign-in: look up employee from DB
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
      // The same working day limit the proxy holds (auth.config).
      if (typeof token.signedInAt !== "number") token.signedInAt = Date.now();
      if (Date.now() - token.signedInAt > SIGN_IN_MS) return null;
      if (token.sub) {
        const live = await liveIdentity(token.sub);
        if (!live) return null;
        // A sign in from before the password was last set or reset ends
        // here, so an administrator's reset (a temporary password, a setup
        // link) reaches a browser left signed in, not only the next sign in.
        // Read from signedInAt, never the token's issue time: every request
        // re-signs the cookie with a fresh one, so it always looked newer
        // than the reset and the old session carried on.
        if (live.passwordChangedAt && token.signedInAt! < live.passwordChangedAt.getTime()) return null;
        token.role = live.role;
        token.employeeId = live.employeeId ?? undefined;
        token.tenantId = live.tenantId;
        token.customRoleId = live.customRoleId ?? undefined;
        token.canViewAs = live.canViewAs;
        token.isActive = live.isActive;
        token.mustChangePassword = live.mustChangePassword;
        // A super admin who is also an employee, inside their own company,
        // is that employee there as well: their own pages work and what they
        // do carries their name. Still a super admin; anywhere else, or with
        // the record inactive, nothing changes. Read per request, because
        // the company cookie changes without a new sign in.
        if (live.isSuperAdmin && live.ownEmployeeId && live.ownTenantId && (await enteredCompany()) === live.ownTenantId) {
          token.employeeId = live.ownEmployeeId;
          token.tenantId = live.ownTenantId;
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
        session.user.canViewAs = token.canViewAs as boolean | undefined ?? false;
        session.user.mustChangePassword = token.mustChangePassword as boolean | undefined ?? false;
        session.user.signInId = token.signInId as string | undefined;
        session.user.isActive = token.isActive as boolean | undefined ?? true;
      }
      return session;
    },
  },
});

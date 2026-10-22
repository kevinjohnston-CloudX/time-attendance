"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sendPasswordInviteEmail } from "@/lib/email/send-invite";
import { mailAddress } from "@/lib/login-email";
import { employeeRank } from "@/lib/rbac/identity";
import { currentIdentity } from "@/lib/rbac/current";
import { getEffectiveRole } from "@/lib/rbac/check-permission";
import { forgetIdentity } from "@/lib/rbac/identity";
import { revokeAllUserTokens } from "@/lib/mobile-auth";
import { zodMessage } from "@/lib/zod-message";

const LOGIN_MANAGERS = ["SYSTEM_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "SUPER_ADMIN"];

/**
 * The employee whose login the caller may reset, or why not.
 *
 * <p>Only an admin, only inside their own company, never their own login
 * (another admin resets it), and only for
 * somebody junior to them. Without the last rule a payroll admin could set a
 * system admin's password and sign in as them. A super admin may reset anyone.
 */
async function manageableLogin(employeeId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Your session has ended. Sign in again, then try once more." } as const;
  // Rank and role as View as sets them, so viewing as a junior role cannot reset logins it could not.
  const caller = await currentIdentity();
  const viewedRole = await getEffectiveRole(session.user);
  if (!caller || !caller.isActive || !LOGIN_MANAGERS.includes(caller.role) || !LOGIN_MANAGERS.includes(viewedRole)) {
    return { error: "You don't have permission to manage sign-ins." } as const;
  }
  const target = await db.employee.findFirst({
    where: { id: employeeId, ...(caller.isSuperAdmin ? {} : { tenantId: caller.tenantId ?? "" }) },
    select: { id: true, tenantId: true, userId: true, user: { select: { id: true, name: true, email: true, workEmail: true } } },
  });
  if (!target) return { error: "This employee isn't available to you. Reload the page and try again." } as const;
  if (!caller.isSuperAdmin) {
    if (target.id === caller.employeeId) {
      return { error: "To change your own password, use Change password in your profile." } as const;
    }
    const rank = await employeeRank(target.id, target.tenantId);
    if (rank === null || rank >= caller.rank) {
      return { error: "Only someone more senior than this person can reset their password." } as const;
    }
  }
  return { target } as const;
}

function sha256(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must contain at least one special character";
  return null;
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Ends every sign in the person has: browsers at their next request (see
 * the jwt callback in auth.ts) and the mobile app at its next refresh. Run
 * whenever their password is set or reset, so a reset after a lost or shared
 * login takes the old sessions with it.
 */
async function endSignIns(userId: string) {
  await db.user.update({ where: { id: userId }, data: { passwordChangedAt: new Date() } });
  await revokeAllUserTokens(userId);
  forgetIdentity(userId);
}

// ── Send invite / reset email ──────────────────────────────────────────────

export async function sendPasswordInvite(employeeId: string): Promise<{ success: boolean; message: string }> {
  const allowed = await manageableLogin(employeeId);
  if ("error" in allowed) return { success: false, message: allowed.error! };
  const employee = allowed.target;

  // The work email first, else the personal one.
  const to = mailAddress(employee?.user);
  if (!employee?.user || !to) {
    return { success: false, message: "This employee has no email address, so no invite can be sent. Add one to their profile, or set a temporary password instead." };
  }

  const rawToken = generateToken();
  const tokenHash = sha256(rawToken);

  // Invalidate any existing unused tokens for this user
  await db.passwordResetToken.updateMany({
    where: { userId: employee.user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await db.passwordResetToken.create({
    data: {
      userId: employee.user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  await endSignIns(employee.user.id);

  const appUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";

  const { sent } = await sendPasswordInviteEmail({
    to,
    name: employee.user.name ?? "there",
    token: rawToken,
    appUrl,
  });

  if (!sent) {
    const setupUrl = `${appUrl}/setup-password?token=${rawToken}`;
    return {
      success: true,
      message: `Email not configured. Share this link manually (expires in 24 hours):\n${setupUrl}`,
    };
  }

  return { success: true, message: "Invite email sent" };
}

// ── Set temporary password (admin sets it directly) ────────────────────────

const tempPasswordSchema = z.object({
  employeeId: z.string().min(1),
  tempPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function setTemporaryPassword(
  employeeId: string,
  tempPassword: string
): Promise<{ success: boolean; message: string }> {
  const parsed = tempPasswordSchema.safeParse({ employeeId, tempPassword });
  if (!parsed.success) {
    return { success: false, message: zodMessage(parsed.error) };
  }

  const strengthError = validatePasswordStrength(tempPassword);
  if (strengthError) return { success: false, message: strengthError };

  const allowed = await manageableLogin(employeeId);
  if ("error" in allowed) return { success: false, message: allowed.error! };
  const employee = allowed.target;

  if (!employee.userId) {
    return { success: false, message: "This employee isn't available to you. Reload the page and try again." };
  }

  const passwordHash = await bcrypt.hash(tempPassword, 12);

  await db.user.update({
    where: { id: employee.userId },
    data: { passwordHash, mustChangePassword: true },
  });
  await endSignIns(employee.userId);

  return { success: true, message: "Temporary password set" };
}

// ── Setup password from email token ───────────────────────────────────────

const setupSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function setupPasswordFromToken(
  token: string,
  password: string
): Promise<{ success: boolean; message: string }> {
  const parsed = setupSchema.safeParse({ token, password });
  if (!parsed.success) {
    return { success: false, message: zodMessage(parsed.error) };
  }

  const tokenHash = sha256(token);

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true } } },
  });

  if (!record) return { success: false, message: "This link isn't valid. Ask HR for a new one." };
  if (record.usedAt) return { success: false, message: "This link was already used. If you didn't set the password, ask HR for a new link." };
  if (record.expiresAt < new Date()) return { success: false, message: "This link has expired. Ask HR for a new one." };

  const strengthError = validatePasswordStrength(password);
  if (strengthError) return { success: false, message: strengthError };

  const passwordHash = await bcrypt.hash(password, 12);

  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: { passwordHash, mustChangePassword: false },
    }),
    db.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
  await endSignIns(record.userId);

  return { success: true, message: "Password set successfully" };
}

// ── Change password (authenticated, post-temp-password forced change) ──────

const changeSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export async function changePassword(
  newPassword: string,
  confirmPassword: string
): Promise<{ success: boolean; message: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, message: "Your session has ended. Sign in again, then try once more." };
  // Only the forced change after a temporary password. Otherwise anyone at a
  // screen left signed in could set the password without knowing it, and keep
  // the account after the session ended.
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { mustChangePassword: true } });
  if (!user?.mustChangePassword) {
    return { success: false, message: "Your password can be changed here only after signing in with a temporary password. Ask HR for a reset link." };
  }

  const parsed = changeSchema.safeParse({ newPassword, confirmPassword });
  if (!parsed.success) {
    return { success: false, message: zodMessage(parsed.error) };
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) return { success: false, message: strengthError };

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await db.user.update({
    where: { id: session.user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  // This browser signs out next (the page does it) and signs in again.
  await endSignIns(session.user.id);

  return { success: true, message: "Password changed successfully" };
}

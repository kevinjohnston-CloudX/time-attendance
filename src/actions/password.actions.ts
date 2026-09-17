"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sendPasswordInviteEmail } from "@/lib/email/send-invite";

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

// ── Send invite / reset email ──────────────────────────────────────────────

export async function sendPasswordInvite(employeeId: string): Promise<{ success: boolean; message: string }> {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Not authenticated" };

  const role = session.user.role;
  if (!["SYSTEM_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "SUPER_ADMIN"].includes(role)) {
    return { success: false, message: "Insufficient permissions" };
  }

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!employee?.user?.email) {
    return { success: false, message: "Employee has no email address configured" };
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

  const appUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";

  const { sent } = await sendPasswordInviteEmail({
    to: employee.user.email,
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
  const session = await auth();
  if (!session?.user) return { success: false, message: "Not authenticated" };

  const role = session.user.role;
  if (!["SYSTEM_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "SUPER_ADMIN"].includes(role)) {
    return { success: false, message: "Insufficient permissions" };
  }

  const parsed = tempPasswordSchema.safeParse({ employeeId, tempPassword });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const strengthError = validatePasswordStrength(tempPassword);
  if (strengthError) return { success: false, message: strengthError };

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });

  if (!employee?.userId) {
    return { success: false, message: "Employee not found" };
  }

  const passwordHash = await bcrypt.hash(tempPassword, 12);

  await db.user.update({
    where: { id: employee.userId },
    data: { passwordHash, mustChangePassword: true },
  });

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
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tokenHash = sha256(token);

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true } } },
  });

  if (!record) return { success: false, message: "Invalid or expired link" };
  if (record.usedAt) return { success: false, message: "This link has already been used" };
  if (record.expiresAt < new Date()) return { success: false, message: "This link has expired" };

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
  if (!session?.user?.id) return { success: false, message: "Not authenticated" };

  const parsed = changeSchema.safeParse({ newPassword, confirmPassword });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) return { success: false, message: strengthError };

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await db.user.update({
    where: { id: session.user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  return { success: true, message: "Password changed successfully" };
}

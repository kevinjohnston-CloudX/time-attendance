import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import { hasPermission, type Permission } from "@/lib/rbac/permissions";

// ---------- Types ----------

export interface MobileTokenPayload extends JWTPayload {
  sub: string; // userId
  employeeId: string;
  role: string;
  tenantId: string | null;
}

export interface MobileActor {
  userId: string;
  employeeId: string;
  role: string;
  tenantId: string | null;
}

// ---------- Errors ----------

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// ---------- Config ----------

const JWT_SECRET = new TextEncoder().encode(
  process.env.MOBILE_JWT_SECRET ?? "",
);
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

// ---------- Access Token (JWT) ----------

export async function signAccessToken(payload: {
  sub: string;
  employeeId: string;
  role: string;
  tenantId: string | null;
}): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyAccessToken(
  token: string,
): Promise<MobileTokenPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as MobileTokenPayload;
}

// ---------- Refresh Token (opaque, DB-stored) ----------

export async function createRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(48).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await db.refreshToken.create({
    data: { token, userId, expiresAt },
  });

  return token;
}

export async function rotateRefreshToken(oldToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const existing = await db.refreshToken.findUnique({
    where: { token: oldToken },
    include: {
      user: { include: { employee: true } },
    },
  });

  if (!existing) {
    throw new AuthError("Invalid refresh token");
  }

  // Reuse detection: if already revoked, someone stole it → revoke all
  if (existing.revokedAt) {
    await revokeAllUserTokens(existing.userId);
    throw new AuthError("Token reuse detected — all sessions revoked");
  }

  if (existing.expiresAt < new Date()) {
    throw new AuthError("Refresh token expired");
  }

  const user = existing.user;
  const employee = user.employee;

  if (!employee || !employee.isActive) {
    throw new AuthError("Employee account is inactive");
  }

  // Rotate: revoke old, create new
  const newToken = randomBytes(48).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await db.$transaction([
    db.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByToken: newToken },
    }),
    db.refreshToken.create({
      data: { token: newToken, userId: user.id, expiresAt },
    }),
  ]);

  const accessToken = await signAccessToken({
    sub: user.id,
    employeeId: employee.id,
    role: employee.role,
    tenantId: employee.tenantId,
  });

  return { accessToken, refreshToken: newToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ---------- Request Authentication ----------

export async function authenticateMobile(req: Request): Promise<MobileActor> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const token = header.slice(7);

  try {
    const payload = await verifyAccessToken(token);
    return {
      userId: payload.sub!,
      employeeId: payload.employeeId,
      role: payload.role,
      tenantId: payload.tenantId,
    };
  } catch {
    throw new AuthError("Invalid or expired access token");
  }
}

// ---------- Permission Check ----------

export function requirePermission(
  actor: MobileActor,
  permission: Permission,
): void {
  if (!hasPermission(actor.role, permission)) {
    throw new ForbiddenError();
  }
}

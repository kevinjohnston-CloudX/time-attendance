import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export type ExternalAuthContext = { tenantId: string };

export async function authenticateApiKey(req: NextRequest): Promise<ExternalAuthContext | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const keyHash = crypto.createHash("sha256").update(token).digest("hex");
  const key = await db.apiKey.findUnique({
    where: { keyHash },
    select: { id: true, tenantId: true, isActive: true },
  });

  if (!key || !key.isActive) return null;

  // Fire-and-forget lastUsedAt update
  db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { tenantId: key.tenantId };
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

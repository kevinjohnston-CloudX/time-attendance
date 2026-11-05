import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateApiKey, missingScope, unauthorized } from "@/lib/api/auth-external";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return unauthorized();
  if (!auth.scopes.includes("time-off:write")) return missingScope("time-off:write");

  const leaveTypes = await db.leaveType.findMany({
    where: { tenantId: auth.tenantId, isActive: true },
    select: {
      externalCode: true,
      name: true,
      category: true,
      requiresApproval: true,
      isPaid: true,
    },
    orderBy: { externalCode: "asc" },
  });

  return NextResponse.json({ leaveTypes });
}

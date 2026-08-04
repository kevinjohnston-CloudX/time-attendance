import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateApiKey, unauthorized } from "@/lib/api/auth-external";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return unauthorized();

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

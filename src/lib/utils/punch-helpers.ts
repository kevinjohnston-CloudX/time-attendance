import { db } from "@/lib/db";
import type { PunchState } from "@prisma/client";

export async function getCurrentPunchState(employeeId: string): Promise<PunchState> {
  const last = await db.punch.findFirst({
    where: { employeeId, isApproved: true, correctedById: null },
    orderBy: { roundedTime: "desc" },
  });
  return last?.stateAfter ?? "OUT";
}

export async function findOpenPayPeriod() {
  const now = new Date();
  return db.payPeriod.findFirst({
    where: {
      startDate: { lte: now },
      endDate: { gte: now },
      status: "OPEN",
    },
  });
}

import { db } from "@/lib/db";
import type { PunchState } from "@prisma/client";

export async function getCurrentPunchState(employeeId: string): Promise<PunchState> {
  const [lastApproved, lastSystemReset] = await Promise.all([
    db.punch.findFirst({
      where: { employeeId, isApproved: true, correctedById: null },
      orderBy: { roundedTime: "desc" },
      select: { stateAfter: true, roundedTime: true },
    }),
    db.punch.findFirst({
      where: { employeeId, isApproved: false, source: "SYSTEM" },
      orderBy: { roundedTime: "desc" },
      select: { stateAfter: true, roundedTime: true },
    }),
  ]);

  if (!lastApproved && !lastSystemReset) return "OUT";
  if (!lastSystemReset) return lastApproved!.stateAfter;
  if (!lastApproved) return lastSystemReset.stateAfter;

  // Most recent punch (approved or system-reset) determines state
  return lastApproved.roundedTime >= lastSystemReset.roundedTime
    ? lastApproved.stateAfter
    : lastSystemReset.stateAfter;
}

export async function findOpenPayPeriod(tenantId: string | null) {
  const now = new Date();
  return db.payPeriod.findFirst({
    where: {
      ...(tenantId && { tenantId }),
      startDate: { lte: now },
      endDate: { gte: now },
      status: "OPEN",
    },
  });
}

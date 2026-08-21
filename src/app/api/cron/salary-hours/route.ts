import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { rebuildSegments } from "@/lib/engines/segment-builder";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const today = new Date();

  // All open pay periods that include today
  const openPeriods = await db.payPeriod.findMany({
    where: {
      startDate: { lte: today },
      endDate: { gte: today },
      status: "OPEN",
    },
    select: { id: true, tenantId: true, ruleSetId: true },
  });

  let processed = 0;

  for (const period of openPeriods) {
    // For rule-set-specific periods: only process employees on that rule set.
    // For tenant-level periods (ruleSetId = null): exclude employees whose rule
    // set has its own period for today (they are handled by that period instead).
    let employees: { id: string; ruleSetId: string }[];

    if (period.ruleSetId) {
      employees = await db.employee.findMany({
        where: { isActive: true, payType: "SALARY", tenantId: period.tenantId, ruleSetId: period.ruleSetId },
        select: { id: true, ruleSetId: true },
      });
    } else {
      const ruleSetsWithOwnPeriod = await db.payPeriod.findMany({
        where: {
          tenantId: period.tenantId,
          ruleSetId: { not: null },
          startDate: { lte: today },
          endDate: { gte: today },
          status: "OPEN",
        },
        select: { ruleSetId: true },
      });
      const excludedRuleSetIds = ruleSetsWithOwnPeriod.map((p) => p.ruleSetId!);
      employees = await db.employee.findMany({
        where: {
          isActive: true,
          payType: "SALARY",
          tenantId: period.tenantId,
          ...(excludedRuleSetIds.length > 0 ? { ruleSetId: { notIn: excludedRuleSetIds } } : {}),
        },
        select: { id: true, ruleSetId: true },
      });
    }

    for (const emp of employees) {
      const ruleSet = await db.ruleSet.findUniqueOrThrow({
        where: { id: emp.ruleSetId },
      });

      const ts = await findOrCreateTimesheet(emp.id, period.id);
      // rebuildSegments now includes ensureSalarySegments internally
      await rebuildSegments(ts.id, ruleSet);
      processed++;
    }
  }

  return NextResponse.json({ ok: true, processed });
}

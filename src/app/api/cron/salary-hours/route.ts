import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { rebuildSegments } from "@/lib/engines/segment-builder";

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
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
      // A rule set with a pay schedule of its own is never paid on a company
      // period. This used to skip only rule sets with a period open at this
      // moment, so a run in the hours before one began (NJ Exempt's periods
      // start at 1 PM Eastern) or across a month boundary (the Netherlands'
      // monthly ones) gave their people 80 hours on a company timecard as well.
      const ruleSetsWithOwnPeriod = await db.ruleSet.findMany({
        where: {
          tenantId: period.tenantId,
          OR: [
            { payFrequency: { not: null }, payPeriodAnchorDate: { not: null } },
            { payPeriods: { some: { startDate: { lte: today }, endDate: { gte: today }, status: "OPEN" } } },
          ],
        },
        select: { id: true },
      });
      const excludedRuleSetIds = ruleSetsWithOwnPeriod.map((r) => r.id);
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

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateTimesheetTransition } from "@/lib/state-machines/timesheet-state";
import { writeAuditLog } from "@/lib/audit/logger";

// Runs at 5:10 AM UTC = ~12:10 AM EST / 1:10 AM EDT, just after detect-missing-punches.
// Auto-submits any OPEN timesheets belonging to pay periods whose endDate has passed,
// moving them to SUBMITTED so they appear in supervisor approval queues.
// Exceptions are NOT required to be resolved — supervisors will see them during approval.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();

  const timesheets = await db.timesheet.findMany({
    where: {
      status: "OPEN",
      payPeriod: {
        status: "OPEN",
        endDate: { lt: now },
      },
    },
    select: {
      id: true,
      status: true,
      employee: { select: { tenantId: true } },
    },
  });

  const results = await Promise.allSettled(
    timesheets.map(async (ts) => {
      const transition = validateTimesheetTransition(ts.status, "SUBMIT");
      if (!transition.valid) throw new Error(transition.error);

      await db.$transaction(async (tx) => {
        await tx.timesheet.update({
          where: { id: ts.id },
          data: { status: transition.newStatus, submittedAt: now },
        });
        await writeAuditLog({
          tenantId: ts.employee.tenantId,
          actorId: null,
          action: "TIMESHEET_SUBMITTED",
          entityType: "TIMESHEET",
          entityId: ts.id,
          changes: {
            before: { status: ts.status },
            after: { status: transition.newStatus, autoSubmitted: true },
          },
        });
      });
    })
  );

  const submitted = results.filter((r) => r.status === "fulfilled").length;
  const errors = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({ total: timesheets.length, submitted, errors });
}

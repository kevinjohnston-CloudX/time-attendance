import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

// Runs at 5:05 AM UTC = ~12:05 AM EST / 1:05 AM EDT
// Scans all active timesheets in open pay periods and calls rebuildSegments,
// which will detect any day before today where an employee clocked in but
// never clocked out and create a MISSING_PUNCH exception.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const timesheets = await db.timesheet.findMany({
    where: {
      payPeriod: { status: "OPEN" },
      status: { notIn: ["LOCKED", "PAYROLL_APPROVED"] },
      punches: {
        some: {
          isApproved: true,
          correctedById: null,
        },
      },
    },
    select: {
      id: true,
      employee: {
        select: {
          ruleSet: true,
        },
      },
    },
  });

  const results = await Promise.allSettled(
    timesheets.map((ts) => rebuildSegments(ts.id, ts.employee.ruleSet))
  );

  const processed = results.filter((r) => r.status === "fulfilled").length;
  const errors = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({ total: timesheets.length, processed, errors });
}

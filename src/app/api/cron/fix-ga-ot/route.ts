import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

const PP_ID = "cmsctl40q000004lagosd2kop"; // Aug 16–29 2026

export async function GET() {
  const timesheets = await db.timesheet.findMany({
    where: {
      payPeriodId: PP_ID,
      employee: { payType: "HOURLY" },
    },
    include: {
      employee: {
        include: {
          ruleSet: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  const log: string[] = [];
  let ok = 0, err = 0;

  for (const ts of timesheets) {
    const name = ts.employee.user?.name ?? ts.employeeId;
    try {
      await rebuildSegments(ts.id, ts.employee.ruleSet);
      ok++;
      log.push(`✓ ${name}`);
    } catch (e) {
      err++;
      log.push(`✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok, err, total: timesheets.length, log });
}

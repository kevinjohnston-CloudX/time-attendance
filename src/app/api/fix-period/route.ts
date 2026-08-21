import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

const PERIOD_A = "cmrsth9ol000004i9f6niigcm"; // old period (becomes Aug 2–15)
const PERIOD_B = "cmsctl40q000004lagosd2kop"; // current period (becomes Aug 16–29)
const PERIOD_C = "cmsijd63h006f04jlguvt9ggz"; // next period (becomes Aug 30–Sep 12)
const BOUNDARY = new Date("2026-08-16T04:00:00.000Z"); // Sunday Aug 16 midnight EDT

export async function GET() {
  const aug2  = new Date("2026-08-02T04:00:00.000Z");
  const aug16 = new Date("2026-08-16T04:00:00.000Z");
  const aug30 = new Date("2026-08-30T04:00:00.000Z");
  const sep13 = new Date("2026-09-13T04:00:00.000Z");

  // ── 1. Correct period boundaries + tenant anchor ──────────────────────────
  const pp = await db.payPeriod.findUnique({ where: { id: PERIOD_A }, select: { tenantId: true } });
  const tenantId = pp!.tenantId;

  await db.$transaction([
    db.payPeriod.update({ where: { id: PERIOD_A }, data: { startDate: aug2,  endDate: aug16 } }),
    db.payPeriod.update({ where: { id: PERIOD_B }, data: { startDate: aug16, endDate: aug30 } }),
    db.payPeriod.update({ where: { id: PERIOD_C }, data: { startDate: aug30, endDate: sep13 } }),
    db.tenant.update({ where: { id: tenantId },    data: { payPeriodAnchorDate: aug16 } }),
  ]);

  // ── 2. Split Period A timesheets at the Aug 16 boundary ──────────────────
  const timesheets = await db.timesheet.findMany({
    where: { payPeriodId: PERIOD_A },
    include: {
      punches: { orderBy: { punchTime: "asc" } },
      employee: { include: { ruleSet: true, user: true } },
    },
  });

  const log: string[] = [];

  for (const ts of timesheets) {
    const pre  = ts.punches.filter(p => p.punchTime <  BOUNDARY);
    const post = ts.punches.filter(p => p.punchTime >= BOUNDARY);
    const name = ts.employee.user?.name ?? ts.employeeId;
    const rs   = ts.employee.ruleSet;

    if (post.length === 0) {
      log.push(`${name}: no post-Aug16 punches — stays in Period A`);
      continue;
    }

    if (pre.length === 0) {
      // All punches are Aug 16+: move entire timesheet to Period B
      await db.timesheet.update({ where: { id: ts.id }, data: { payPeriodId: PERIOD_B } });
      await db.workSegment.deleteMany({ where: { timesheetId: ts.id } });
      await db.overtimeBucket.deleteMany({ where: { timesheetId: ts.id } });
      if (rs) await rebuildSegments(ts.id, rs);
      log.push(`${name}: moved entirely to Period B (${post.length} punches), rebuilt`);
      continue;
    }

    // Mixed: keep Period A timesheet for pre-boundary punches,
    // create Period B timesheet for post-boundary punches
    const existing = await db.timesheet.findUnique({
      where: { employeeId_payPeriodId: { employeeId: ts.employeeId, payPeriodId: PERIOD_B } },
    });
    const ts2 = existing ?? await db.timesheet.create({
      data: { employeeId: ts.employeeId, payPeriodId: PERIOD_B },
    });

    await db.punch.updateMany({
      where: { timesheetId: ts.id, punchTime: { gte: BOUNDARY } },
      data:  { timesheetId: ts2.id },
    });

    await db.workSegment.deleteMany({ where: { timesheetId: { in: [ts.id, ts2.id] } } });
    await db.overtimeBucket.deleteMany({ where: { timesheetId: { in: [ts.id, ts2.id] } } });

    if (rs) {
      await rebuildSegments(ts.id,  rs);
      await rebuildSegments(ts2.id, rs);
    }

    log.push(`${name}: split — ${pre.length} pre / ${post.length} post punches → Period B ts ${ts2.id}`);
  }

  return NextResponse.json({ ok: true, periods: { A: aug2+"/"+aug16, B: aug16+"/"+aug30, C: aug30+"/"+sep13 }, log });
}

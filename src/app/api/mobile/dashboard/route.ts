import { NextRequest, NextResponse } from "next/server";
import { getYear, differenceInCalendarDays } from "date-fns";
import { db } from "@/lib/db";
import {
  authenticateMobile,
  requirePermission,
  AuthError,
  ForbiddenError,
} from "@/lib/mobile-auth";
import {
  getCurrentPunchState,
  findOpenPayPeriod,
} from "@/lib/utils/punch-helpers";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import { hoursForTimesheets } from "@/lib/payroll/timecard-hours.server";
import { NO_HOURS } from "@/lib/payroll/timecard-hours";

export async function GET(req: NextRequest) {
  try {
    const actor = await authenticateMobile(req);
    requirePermission(actor, "PUNCH_OWN");

    const employee = await db.employee.findUnique({
      where: { id: actor.employeeId },
      select: { ruleSetId: true, timeZone: true, site: { select: { timezone: true } } },
    });

    const [punchState, payPeriod, lastPunch, leaveBalances] = await Promise.all(
      [
        getCurrentPunchState(actor.employeeId),
        findOpenPayPeriod(actor.tenantId, employee?.ruleSetId, { timezone: employee ? personTimeZone(employee) : undefined }),
        db.punch.findFirst({
          where: {
            employeeId: actor.employeeId,
            isApproved: true,
            correctedById: null,
          },
          orderBy: { punchTime: "desc" },
          select: {
            id: true,
            punchType: true,
            punchTime: true,
            roundedTime: true,
            stateAfter: true,
          },
        }),
        db.leaveBalance.findMany({
          where: {
            employeeId: actor.employeeId,
            accrualYear: getYear(new Date()),
          },
          include: { leaveType: { select: { name: true } } },
        }),
      ],
    );

    let timesheet = null;
    if (payPeriod) {
      const ts = await db.timesheet.findFirst({
        where: {
          employeeId: actor.employeeId,
          payPeriodId: payPeriod.id,
        },
        select: { id: true, status: true },
      });
      if (ts) {
        // As the timecard shows them, counted from its lines.
        const h = (await hoursForTimesheets([ts.id])).get(ts.id) ?? NO_HOURS;
        timesheet = {
          id: ts.id,
          status: ts.status,
          totalMinutes: h.total,
          regMinutes: h.reg,
          otMinutes: h.ot,
          dtMinutes: h.dt,
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        punchState,
        lastPunch,
        payPeriod: payPeriod
          ? {
              id: payPeriod.id,
              startDate: payPeriod.startDate,
              endDate: payPeriod.endDate,
              daysRemaining: differenceInCalendarDays(
                payPeriod.endDate,
                new Date(),
              ),
            }
          : null,
        timesheet,
        leaveBalances: leaveBalances.map((b) => ({
          id: b.id,
          leaveTypeName: b.leaveType.name,
          balanceMinutes: b.balanceMinutes,
          usedMinutes: b.usedMinutes,
        })),
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.status },
      );
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 403 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";

// ─── Employee list for timecard sidebar ──────────────────────────────────────

export const getTimecardEmployeeList = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: { payPeriodId: string }) => {
    const { payPeriodId } = z.object({ payPeriodId: z.string() }).parse(input);

    const timesheets = await db.timesheet.findMany({
      where: { payPeriodId },
      include: {
        employee: {
          include: {
            user: true,
            department: true,
          },
        },
        overtimeBuckets: true,
      },
      orderBy: { employee: { user: { name: "asc" } } },
    });

    return timesheets.map((ts) => ({
      timesheetId: ts.id,
      employeeId: ts.employeeId,
      name: ts.employee.user?.name ?? ts.employeeId,
      employeeCode: ts.employee.employeeCode,
      department: ts.employee.department.name,
      status: ts.status,
      totalMinutes: ts.overtimeBuckets.reduce(
        (sum, b) => sum + b.totalMinutes,
        0
      ),
    }));
  }
);

// ─── Full timecard detail ────────────────────────────────────────────────────

export const getTimecardDetail = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: { timesheetId: string }) => {
    const { timesheetId } = z
      .object({ timesheetId: z.string() })
      .parse(input);

    const ts = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: {
        payPeriod: true,
        employee: {
          include: {
            user: true,
            department: true,
            ruleSet: {
              select: {
                autoDeductMeal: true,
                mealBreakMinutes: true,
                mealBreakAfterMinutes: true,
              },
            },
          },
        },
        punches: {
          where: { isApproved: true, correctedById: null },
          orderBy: { roundedTime: "asc" },
        },
        segments: {
          orderBy: { startTime: "asc" },
          include: {
            leaveRequest: {
              select: {
                id: true,
                leaveType: { select: { name: true, category: true } },
              },
            },
          },
        },
        overtimeBuckets: true,
        exceptions: { where: { resolvedAt: null } },
        mealWaivers: true,
      },
    });

    return {
      ...ts,
      mealWaivers: ts.mealWaivers.map((w) => ({
        id: w.id,
        segmentDate: w.segmentDate.toISOString().slice(0, 10),
        reason: w.reason,
      })),
    };
  }
);

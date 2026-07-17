"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";

// ─── Employee list for timecard sidebar ──────────────────────────────────────

export const getTimecardEmployeeList = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: { payPeriodId: string; siteId?: string | null; departmentId?: string | null }) => {
    const { payPeriodId, siteId, departmentId } = z.object({
      payPeriodId: z.string(),
      siteId: z.string().nullish(),
      departmentId: z.string().nullish(),
    }).parse(input);

    const empFilter: Record<string, unknown> = {};
    if (siteId) empFilter.siteId = siteId;
    if (departmentId) empFilter.departmentId = departmentId;

    const timesheets = await db.timesheet.findMany({
      where: {
        payPeriodId,
        ...(Object.keys(empFilter).length > 0 ? { employee: empFilter } : {}),
      },
      include: {
        employee: {
          include: {
            user: true,
            department: true,
          },
        },
        overtimeBuckets: true,
        exceptions: {
          where: { resolvedAt: null },
          select: { exceptionType: true },
        },
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
      isActive: ts.employee.isActive,
      totalMinutes: ts.overtimeBuckets.reduce(
        (sum, b) => sum + b.totalMinutes,
        0
      ),
      exceptionTypes: [
        ...new Set(ts.exceptions.map((e) => e.exceptionType)),
      ],
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
            payCode: {
              select: { id: true, code: true, label: true },
            },
          },
        },
        overtimeBuckets: true,
        exceptions: {
          where: { resolvedAt: null },
          select: { id: true, exceptionType: true, occurredAt: true, description: true },
        },
        mealWaivers: true,
        notes: true,
        dayReasons: {
          include: { reasonCode: { select: { id: true, code: true, label: true, color: true } } },
        },
      },
    });

    return {
      ...ts,
      mealWaivers: ts.mealWaivers.map((w) => ({
        id: w.id,
        segmentDate: w.segmentDate.toISOString().slice(0, 10),
        reason: w.reason,
      })),
      notes: ts.notes.map((n) => ({
        id: n.id,
        noteDate: n.noteDate.toISOString().slice(0, 10),
        note: n.note,
        createdById: n.createdById,
      })),
    };
  }
);

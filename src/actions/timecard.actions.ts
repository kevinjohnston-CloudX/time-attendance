"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";

// ─── Active employee directory (employee-centric timecard) ───────────────────

export const getActiveEmployeesForTimecards = withRBAC(
  ["TIMECARD_VIEW_ANY", "TIMECARD_EDIT_ANY"],
  async ({ tenantId }, input: { siteId?: string | null; departmentId?: string | null; payPeriodId?: string | null }) => {
    const { siteId, departmentId, payPeriodId: payPeriodIdInput } = z.object({
      siteId: z.string().nullish(),
      departmentId: z.string().nullish(),
      payPeriodId: z.string().nullish(),
    }).parse(input);

    // Fall back to the current tenant pay period for exception dot display
    let payPeriodId = payPeriodIdInput ?? null;
    if (!payPeriodId && tenantId) {
      const now = new Date();
      const current = await db.payPeriod.findFirst({
        where: { tenantId, ruleSetId: null, startDate: { lte: now }, endDate: { gt: now } },
        select: { id: true },
        orderBy: { startDate: "desc" },
      });
      payPeriodId = current?.id ?? null;
    }

    const employees = await db.employee.findMany({
      where: {
        isActive: true,
        ...(siteId ? { siteId } : {}),
        ...(departmentId ? { departmentId } : {}),
      },
      include: {
        user: { select: { name: true } },
        department: { select: { name: true } },
        site: { select: { id: true, name: true } },
        ...(payPeriodId
          ? {
              timesheets: {
                where: { payPeriodId },
                select: {
                  exceptions: {
                    where: { resolvedAt: null },
                    select: { exceptionType: true },
                  },
                },
              },
            }
          : {}),
      },
      orderBy: { user: { name: "asc" } },
    });

    return employees.map((emp) => {
      const timesheetExceptions: string[] = payPeriodId
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? ((emp as any).timesheets as { exceptions: { exceptionType: string }[] }[] | undefined)
            ?.flatMap((ts) => ts.exceptions.map((e) => e.exceptionType)) ?? []
        : [];

      return {
        employeeId: emp.id,
        name: emp.user?.name ?? emp.id,
        employeeCode: emp.employeeCode,
        department: emp.department.name,
        siteId: emp.site?.id ?? null,
        siteName: emp.site?.name ?? null,
        isActive: emp.isActive,
        payType: emp.payType ?? null,
        exceptionTypes: [...new Set(timesheetExceptions)],
      };
    });
  }
);

// ─── Team employees for supervisor view ──────────────────────────────────────

export const getTeamEmployeesForTimecards = withRBAC(
  ["TIMECARD_VIEW_TEAM", "TIMECARD_EDIT_TEAM"],
  async ({ employeeId, tenantId }, _input: Record<string, never>) => {
    const employees = await db.employee.findMany({
      where: {
        isActive: true,
        supervisorId: employeeId,
        ...(tenantId ? { tenantId } : {}),
      },
      include: {
        user: { select: { name: true } },
        department: { select: { name: true } },
        site: { select: { id: true, name: true } },
      },
      orderBy: { user: { name: "asc" } },
    });

    return employees.map((emp) => ({
      employeeId: emp.id,
      name: emp.user?.name ?? emp.id,
      employeeCode: emp.employeeCode,
      department: emp.department.name,
      siteId: emp.site?.id ?? null,
      siteName: emp.site?.name ?? null,
      isActive: emp.isActive,
      payType: emp.payType ?? null,
      exceptionTypes: [] as string[],
    }));
  }
);

// ─── Periods for a specific employee's rule set ───────────────────────────────

export const getEmployeePeriods = withRBAC(
  ["TIMECARD_VIEW_TEAM", "TIMECARD_VIEW_ANY", "TIMECARD_EDIT_TEAM", "TIMECARD_EDIT_ANY"],
  async (_ctx, input: { employeeId: string }) => {
    const { employeeId } = z.object({ employeeId: z.string() }).parse(input);

    const employee = await db.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: {
        tenantId: true,
        ruleSet: { select: { id: true, payFrequency: true, payPeriodAnchorDate: true } },
      },
    });

    const ruleSet = employee.ruleSet;
    const hasOwnSchedule = !!(ruleSet?.payFrequency && ruleSet?.payPeriodAnchorDate);

    let periods = await db.payPeriod.findMany({
      where: hasOwnSchedule
        ? { ruleSetId: ruleSet!.id }
        : { tenantId: employee.tenantId, ruleSetId: null },
      orderBy: { startDate: "asc" },
      select: { id: true, startDate: true, endDate: true, status: true },
    });

    // Also include tenant-level periods where this employee has a timesheet —
    // handles the case where the rule set was applied mid-year and historical
    // timesheets still live in those tenant-level periods. Excludes tenant-level
    // periods that overlap with existing ruleset-specific periods to avoid duplicates.
    if (hasOwnSchedule) {
      const historicTenantPeriods = await db.payPeriod.findMany({
        where: {
          tenantId: employee.tenantId,
          ruleSetId: null,
          timesheets: { some: { employeeId } },
        },
        orderBy: { startDate: "asc" },
        select: { id: true, startDate: true, endDate: true, status: true },
      });
      const seen = new Set(periods.map((p) => p.id));
      const merged = [...periods];
      for (const p of historicTenantPeriods) {
        if (!seen.has(p.id)) merged.push(p);
      }
      periods = merged.sort(
        (a, b) => a.startDate.getTime() - b.startDate.getTime()
      );
    }

    const tenant = await db.tenant.findUnique({
      where: { id: employee.tenantId },
      select: { payFrequency: true },
    });

    const payFrequency = (hasOwnSchedule && ruleSet!.payFrequency)
      ? ruleSet!.payFrequency!
      : (tenant?.payFrequency ?? "BIWEEKLY");

    return {
      payFrequency: payFrequency as string,
      periods: periods.map((pp) => ({
        id: pp.id,
        startDate: pp.startDate.toISOString(),
        endDate: pp.endDate.toISOString(),
        status: pp.status,
      })),
    };
  }
);

// ─── Timecard by employee + period (employee-centric lookup) ─────────────────

export const getTimecardByEmployeeAndPeriod = withRBAC(
  ["TIMECARD_VIEW_TEAM", "TIMECARD_VIEW_ANY", "TIMECARD_EDIT_TEAM", "TIMECARD_EDIT_ANY"],
  async (_ctx, input: { employeeId: string; periodId: string }) => {
    const { employeeId, periodId } = z.object({
      employeeId: z.string(),
      periodId: z.string(),
    }).parse(input);

    const ts = await db.timesheet.findUnique({
      where: { employeeId_payPeriodId: { employeeId, payPeriodId: periodId } },
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
                overtimeRequiresAuth: true,
                allowTimesheetOtAuth: true,
                defaultPayCodeId: true,
              },
            },
          },
        },
        punches: {
          where: { isApproved: true, correctedById: null },
          orderBy: { roundedTime: "asc" },
          select: { id: true, punchType: true, roundedTime: true, source: true },
        },
        segments: {
          orderBy: { startTime: "asc" },
          include: {
            leaveRequest: {
              select: {
                id: true,
                leaveType: {
                  select: {
                    name: true,
                    category: true,
                    payCode: { select: { id: true, code: true, label: true } },
                  },
                },
              },
            },
            payCode: { select: { id: true, code: true, label: true } },
          },
        },
        overtimeBuckets: true,
        exceptions: {
          where: { resolvedAt: null },
          select: { id: true, exceptionType: true, occurredAt: true, description: true },
        },
        mealWaivers: true,
        notes: { orderBy: { createdAt: "desc" } },
        dayReasons: {
          include: { reasonCode: { select: { id: true, code: true, label: true, color: true } } },
        },
      },
    });

    if (!ts) return null;

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
        createdByName: n.createdByName ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }
);

// ─── Create or retrieve a timesheet for an employee+period ───────────────────

export const ensureTimesheet = withRBAC(
  ["TIMECARD_EDIT_TEAM", "TIMECARD_EDIT_ANY"],
  async (_ctx, input: { employeeId: string; periodId: string }) => {
    const { employeeId, periodId } = z.object({
      employeeId: z.string(),
      periodId: z.string(),
    }).parse(input);

    const ts = await db.timesheet.upsert({
      where: { employeeId_payPeriodId: { employeeId, payPeriodId: periodId } },
      create: { employeeId, payPeriodId: periodId },
      update: {},
      select: { id: true },
    });

    return { timesheetId: ts.id };
  }
);

// ─── Employee list for timecard sidebar ──────────────────────────────────────

export const getTimecardEmployeeList = withRBAC(
  ["TIMECARD_VIEW_ANY", "TIMECARD_EDIT_ANY"],
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
            site: { select: { id: true, name: true } },
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
      siteId: ts.employee.site?.id ?? null,
      siteName: ts.employee.site?.name ?? null,
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
  ["TIMECARD_VIEW_TEAM", "TIMECARD_VIEW_ANY", "TIMECARD_EDIT_TEAM", "TIMECARD_EDIT_ANY"],
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
                overtimeRequiresAuth: true,
                allowTimesheetOtAuth: true,
                defaultPayCodeId: true,
              },
            },
          },
        },
        punches: {
          where: { isApproved: true, correctedById: null },
          orderBy: { roundedTime: "asc" },
          select: { id: true, punchType: true, roundedTime: true, source: true },
        },
        segments: {
          orderBy: { startTime: "asc" },
          include: {
            leaveRequest: {
              select: {
                id: true,
                leaveType: {
                  select: {
                    name: true,
                    category: true,
                    payCode: { select: { id: true, code: true, label: true } },
                  },
                },
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
        notes: {
          orderBy: { createdAt: "desc" },
        },
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
        createdByName: n.createdByName ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }
);

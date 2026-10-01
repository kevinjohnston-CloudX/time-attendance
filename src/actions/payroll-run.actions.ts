"use server";

import { z } from "zod";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { buildAdpEpi, employeeWhere, type EpiFilters, type EpiSummary } from "@/lib/payroll/adp-epi";
import { lockPeriod } from "@/lib/payroll/lock-period";
import { periodLastDay, periodRange } from "@/lib/pay-period-display";
import type { PayFrequency } from "@prisma/client";

/**
 * Run Payroll: lock a pay period's dates and build the ADP EPI file for them.
 * One company runs a period per rule set over the same dates, so a run is for
 * a date range and takes in every period on those dates; the filters narrow
 * who goes in the file.
 */

export type PeriodGroup = {
  key: string;
  label: string;
  startDate: string;
  periods: { id: string; name: string; status: string; timecards: number }[];
};

export const getRunPayrollOptions = withRBAC("PAYROLL_RUN", async ({ tenantId }, _input: void) => {
  if (!tenantId) throw new Error("Tenant context required");
  const [tenant, periods, ruleSets, payCategories, sites, departments, agencies] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { payFrequency: true } }),
    db.payPeriod.findMany({
      where: { tenantId },
      orderBy: [{ startDate: "desc" }, { endDate: "desc" }],
      select: {
        id: true, startDate: true, endDate: true, status: true,
        ruleSet: { select: { name: true, payFrequency: true } },
        _count: { select: { timesheets: true } },
      },
    }),
    db.ruleSet.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.payCategory.findMany({ where: { tenantId, isActive: true }, orderBy: { number: "asc" }, select: { id: true, number: true, description: true } }),
    db.site.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.agency.findMany({ where: { tenantId }, orderBy: { code: "asc" }, select: { id: true, code: true, description: true } }),
  ]);

  const groups = new Map<string, PeriodGroup>();
  for (const p of periods) {
    const key = `${p.startDate.toISOString()}|${p.endDate.toISOString()}`;
    const freq = (p.ruleSet?.payFrequency ?? tenant.payFrequency) as PayFrequency;
    const g = groups.get(key) ?? {
      key,
      label: periodRange(p.startDate, periodLastDay(p.endDate, freq)),
      startDate: p.startDate.toISOString(),
      periods: [],
    };
    g.periods.push({ id: p.id, name: p.ruleSet?.name ?? "Company default", status: p.status, timecards: p._count.timesheets });
    groups.set(key, g);
  }

  return {
    // Only dates somebody has a timecard on are worth running.
    periodGroups: [...groups.values()].filter((g) => g.periods.some((p) => p.timecards > 0)),
    ruleSets,
    payCategories: payCategories.map((c) => ({ id: c.id, name: `${c.number}${c.description ? ` (${c.description})` : ""}` })),
    sites,
    departments,
    agencies: agencies.map((a) => ({ id: a.id, name: `${a.code} (${a.description})` })),
  };
});

const runSchema = z.object({
  periodKey: z.string().regex(/^[^|]+\|[^|]+$/, "Choose a pay period"),
  filters: z.object({
    badgeIds: z.string().optional(),
    ruleSetIds: z.array(z.string()).default([]),
    payCategoryIds: z.array(z.string()).default([]),
    siteIds: z.array(z.string()).default([]),
    departmentIds: z.array(z.string()).default([]),
    agencyIds: z.array(z.string()).default([]),
  }),
  codes: z.object({
    coCode: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/, "Enter the ADP company code (letters and numbers)"),
    batchId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/, "Enter a batch ID (letters, numbers, - or _)"),
    doubleTimeCode: z.string().trim().regex(/^[A-Za-z0-9]{0,6}$/, "The double time code is letters and numbers only"),
    mealPenaltyCode: z.string().trim().regex(/^[A-Za-z0-9]{0,6}$/, "The meal penalty code is letters and numbers only"),
  }),
});
export type RunPayrollInput = z.input<typeof runSchema>;

function parseFilters(f: z.infer<typeof runSchema>["filters"]): EpiFilters {
  const badgeIds = (f.badgeIds ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  return {
    badgeIds: badgeIds.length ? badgeIds : undefined,
    ruleSetIds: f.ruleSetIds,
    payCategoryIds: f.payCategoryIds,
    siteIds: f.siteIds,
    departmentIds: f.departmentIds,
    agencyIds: f.agencyIds,
  };
}

async function periodsForKey(tenantId: string, key: string) {
  const [start, end] = key.split("|").map((s) => new Date(s));
  if (Number.isNaN(+start) || Number.isNaN(+end)) throw new Error("Choose a pay period");
  const periods = await db.payPeriod.findMany({
    where: { tenantId, startDate: start, endDate: end },
    select: { id: true, status: true, startDate: true, endDate: true, ruleSet: { select: { name: true, payFrequency: true } } },
  });
  if (periods.length === 0) throw new Error("That pay period was not found");
  return periods;
}

/** The periods holding at least one timecard these filters take in: the ones Process locks. */
async function periodsInRun(tenantId: string, periodIds: string[], filters: EpiFilters) {
  const rows = await db.timesheet.groupBy({
    by: ["payPeriodId"],
    where: { payPeriodId: { in: periodIds }, employee: employeeWhere(tenantId, filters) },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.payPeriodId, r._count._all]));
}

export type RunPreview = {
  summary: EpiSummary;
  toLock: { name: string; timecards: number; alsoOutsideFilters: number }[];
  alreadyLocked: string[];
};

export const previewPayrollRun = withRBAC("PAYROLL_RUN", async ({ tenantId }, input: RunPayrollInput): Promise<RunPreview> => {
  if (!tenantId) throw new Error("Tenant context required");
  const parsed = runSchema.parse(input);
  const filters = parseFilters(parsed.filters);
  const periods = await periodsForKey(tenantId, parsed.periodKey);
  const inRun = await periodsInRun(tenantId, periods.map((p) => p.id), filters);
  const totals = await periodsInRun(tenantId, periods.map((p) => p.id), {});

  const { summary } = await buildAdpEpi({ tenantId, payPeriodIds: periods.map((p) => p.id), filters, codes: parsed.codes, mode: "preview" });

  const open = periods.filter((p) => inRun.has(p.id) && p.status !== "LOCKED");
  return {
    summary,
    toLock: open.map((p) => ({
      name: p.ruleSet?.name ?? "Company default",
      timecards: totals.get(p.id) ?? 0,
      alsoOutsideFilters: (totals.get(p.id) ?? 0) - (inRun.get(p.id) ?? 0),
    })),
    alreadyLocked: periods.filter((p) => inRun.has(p.id) && p.status === "LOCKED").map((p) => p.ruleSet?.name ?? "Company default"),
  };
});

export const processPayrollRun = withRBAC(
  "PAYROLL_RUN",
  async (ctx, input: RunPayrollInput): Promise<{ csv: string; filename: string; summary: EpiSummary; locked: number }> => {
    const { tenantId, employeeId } = ctx;
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = runSchema.parse(input);
    const filters = parseFilters(parsed.filters);
    const periods = await periodsForKey(tenantId, parsed.periodKey);
    const periodIds = periods.map((p) => p.id);

    // Refuse before locking anything if the file could not be written as asked.
    const check = await buildAdpEpi({ tenantId, payPeriodIds: periodIds, filters, codes: parsed.codes, mode: "preview" });
    if (check.summary.employees === 0) throw new Error("Nobody with hours matches these filters.");
    if (check.summary.needsDoubleTimeCode) throw new Error("Some hours are double time. Enter the ADP code for double time.");
    if (check.summary.needsMealPenaltyCode) throw new Error("Some hours are meal penalties. Enter the ADP code for meal penalty.");

    const inRun = await periodsInRun(tenantId, periodIds, filters);
    const toLock = periods.filter((p) => inRun.has(p.id) && p.status !== "LOCKED");
    for (const p of toLock) await lockPeriod(p.id, ctx);

    const { csv, summary } = await buildAdpEpi({ tenantId, payPeriodIds: periodIds, filters, codes: parsed.codes, mode: "final" });

    const first = periods[0];
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { payFrequency: true } });
    const freq = (first.ruleSet?.payFrequency ?? tenant.payFrequency) as PayFrequency;
    const startDay = first.startDate.toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `EPI${parsed.codes.coCode}01_${startDay}_${format(periodLastDay(first.endDate, freq), "yyyyMMdd")}.csv`;

    for (const p of periods.filter((pp) => inRun.has(pp.id))) {
      await writeAuditLog({
        tenantId,
        actorId: employeeId,
        entityType: "PAY_PERIOD",
        entityId: p.id,
        action: "ADP_FILE_EXPORTED",
        changes: {
          after: {
            filename,
            coCode: parsed.codes.coCode,
            batchId: parsed.codes.batchId,
            filters: parsed.filters,
            employees: summary.employees,
            rows: summary.rows,
            lockedByThisRun: toLock.some((t) => t.id === p.id),
          },
        },
      });
    }

    return { csv, filename, summary, locked: toLock.length };
  },
);

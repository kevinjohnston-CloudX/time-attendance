"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { buildAdpEpi, employeeWhere, type EpiFilters, type EpiSummary } from "@/lib/payroll/adp-epi";
import { lockPeriod } from "@/lib/payroll/lock-period";
import { dayKey, FREQ_LABEL, periodLastDay } from "@/lib/pay-period-display";
import type { PayFrequency } from "@prisma/client";

/**
 * Run Payroll: lock the pay periods of one frequency that fall inside a date
 * range, and build the ADP EPI file for them. A company runs a period per rule
 * set, so one run takes in every rule set's period of that frequency inside
 * the dates; the filters narrow who goes in the file.
 */

const FREQUENCIES: PayFrequency[] = ["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type RunPeriod = {
  name: string;
  frequency: PayFrequency;
  startDay: string;
  lastDay: string;
  status: string;
  timecards: number;
};

export type RunFrequency = { value: PayFrequency; label: string; defaultFrom: string; defaultTo: string };

/** Every period of the company, with its frequency and its first and last calendar day. */
async function companyPeriods(tenantId: string) {
  const [tenant, rows] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { payFrequency: true } }),
    db.payPeriod.findMany({
      where: { tenantId },
      select: {
        id: true, startDate: true, endDate: true, status: true,
        ruleSet: { select: { name: true, payFrequency: true } },
        _count: { select: { timesheets: true } },
      },
    }),
  ]);
  return rows.map((p) => {
    const frequency = (p.ruleSet?.payFrequency ?? tenant.payFrequency) as PayFrequency;
    return {
      id: p.id,
      name: p.ruleSet?.name ?? "Company default",
      frequency,
      status: p.status,
      timecards: p._count.timesheets,
      startDay: p.startDate.toISOString().slice(0, 10),
      lastDay: dayKey(periodLastDay(p.endDate, frequency)),
    };
  });
}

export const getRunPayrollOptions = withRBAC("PAYROLL_RUN", async ({ tenantId }, _input: void) => {
  if (!tenantId) throw new Error("Tenant context required");
  const [periods, ruleSets, payCategories, sites, departments, agencies] = await Promise.all([
    companyPeriods(tenantId),
    db.ruleSet.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.payCategory.findMany({ where: { tenantId, isActive: true }, orderBy: { number: "asc" }, select: { id: true, number: true, description: true } }),
    db.site.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.agency.findMany({ where: { tenantId }, orderBy: { code: "asc" }, select: { id: true, code: true, description: true } }),
  ]);

  const withHours = periods.filter((p) => p.timecards > 0);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Each frequency opens on its most recent period that has already ended.
  const frequencies: RunFrequency[] = [];
  for (const value of FREQUENCIES) {
    const ofFreq = withHours.filter((p) => p.frequency === value);
    if (ofFreq.length === 0) continue;
    const dates = new Map<string, { startDay: string; lastDay: string; timecards: number }>();
    for (const p of ofFreq) {
      const key = `${p.startDay}|${p.lastDay}`;
      const d = dates.get(key) ?? { startDay: p.startDay, lastDay: p.lastDay, timecards: 0 };
      d.timecards += p.timecards;
      dates.set(key, d);
    }
    const byRecent = [...dates.values()].sort((a, b) => b.lastDay.localeCompare(a.lastDay) || b.timecards - a.timecards);
    const pick = byRecent.find((d) => d.lastDay < today) ?? byRecent[byRecent.length - 1];
    frequencies.push({ value, label: FREQ_LABEL[value], defaultFrom: pick.startDay, defaultTo: pick.lastDay });
  }

  return {
    frequencies,
    periods: withHours.map((p): RunPeriod => ({
      name: p.name, frequency: p.frequency, startDay: p.startDay, lastDay: p.lastDay, status: p.status, timecards: p.timecards,
    })),
    ruleSets,
    payCategories: payCategories.map((c) => ({ id: c.id, name: `${c.number}${c.description ? ` (${c.description})` : ""}` })),
    sites,
    departments,
    agencies: agencies.map((a) => ({ id: a.id, name: `${a.code} (${a.description})` })),
  };
});

const runSchema = z.object({
  frequency: z.enum(["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"]),
  from: z.string().regex(DAY, "Choose a From date"),
  to: z.string().regex(DAY, "Choose a To date"),
  filters: z.object({
    badgeIds: z.string().optional(),
    ruleSetIds: z.array(z.string()).default([]),
    payCategoryIds: z.array(z.string()).default([]),
    siteIds: z.array(z.string()).default([]),
    departmentIds: z.array(z.string()).default([]),
    agencyIds: z.array(z.string()).default([]),
    excludeMissedPunches: z.boolean().default(false),
  }),
  /** Process only: go ahead although timecards in the file have open missed punches. */
  acknowledgeMissedPunches: z.boolean().default(false),
  codes: z.object({
    coCode: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/, "Enter the ADP company code (letters and numbers)"),
    batchId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/, "Enter a batch ID (letters, numbers, - or _)"),
    doubleTimeCode: z.string().trim().regex(/^[A-Za-z0-9]{0,6}$/, "The double time code is letters and numbers only"),
    mealPenaltyCode: z.string().trim().regex(/^[A-Za-z0-9]{0,6}$/, "The meal penalty code is letters and numbers only"),
  }),
}).refine((v) => v.from <= v.to, { message: "The From date must be on or before the To date" });
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
    excludeMissedPunches: f.excludeMissedPunches,
  };
}

/** The missed punch filter only removes people: who is in the run, for locking, ignores it. */
function withoutMissedPunchFilter(f: EpiFilters): EpiFilters {
  return { ...f, excludeMissedPunches: false };
}

/** The periods of this frequency that lie wholly inside the dates. */
async function periodsInRange(tenantId: string, frequency: PayFrequency, from: string, to: string) {
  const periods = (await companyPeriods(tenantId)).filter(
    (p) => p.frequency === frequency && p.startDay >= from && p.lastDay <= to,
  );
  if (periods.length === 0) throw new Error(`No ${FREQ_LABEL[frequency].toLowerCase()} pay periods fall inside these dates.`);
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
  const periods = await periodsInRange(tenantId, parsed.frequency, parsed.from, parsed.to);
  const ids = periods.map((p) => p.id);
  const [inRun, totals] = await Promise.all([periodsInRun(tenantId, ids, withoutMissedPunchFilter(filters)), periodsInRun(tenantId, ids, {})]);

  const { summary } = await buildAdpEpi({ tenantId, payPeriodIds: ids, filters, codes: parsed.codes, mode: "preview" });

  const label = (p: (typeof periods)[number]) => `${p.name} (${p.startDay} to ${p.lastDay})`;
  return {
    summary,
    toLock: periods
      .filter((p) => inRun.has(p.id) && p.status !== "LOCKED")
      .map((p) => ({
        name: label(p),
        timecards: totals.get(p.id) ?? 0,
        alsoOutsideFilters: (totals.get(p.id) ?? 0) - (inRun.get(p.id) ?? 0),
      })),
    alreadyLocked: periods.filter((p) => inRun.has(p.id) && p.status === "LOCKED").map(label),
  };
});

/**
 * The file Process would write, built from the same timecards, without
 * locking anything or logging a run. Named DRAFT_ so it is never mistaken
 * for the one to upload.
 */
export const draftPayrollFile = withRBAC(
  "PAYROLL_RUN",
  async ({ tenantId }, input: RunPayrollInput): Promise<{ csv: string; filename: string }> => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = runSchema.parse(input);
    const filters = parseFilters(parsed.filters);
    const periods = await periodsInRange(tenantId, parsed.frequency, parsed.from, parsed.to);

    const { csv, summary } = await buildAdpEpi({ tenantId, payPeriodIds: periods.map((p) => p.id), filters, codes: parsed.codes, mode: "preview" });
    if (summary.employees === 0) throw new Error("Nobody with hours matches these filters.");
    if (summary.needsDoubleTimeCode) throw new Error("Some hours are double time. Enter the ADP code for double time.");
    if (summary.needsMealPenaltyCode) throw new Error("Some hours are meal penalties. Enter the ADP code for meal penalty.");

    return { csv, filename: `DRAFT_EPI${parsed.codes.coCode}01_${parsed.from.replace(/-/g, "")}_${parsed.to.replace(/-/g, "")}.csv` };
  },
);

export const processPayrollRun = withRBAC(
  "PAYROLL_RUN",
  async (ctx, input: RunPayrollInput): Promise<{ csv: string; filename: string; summary: EpiSummary; locked: number; leftOpen: number }> => {
    const { tenantId, employeeId } = ctx;
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = runSchema.parse(input);
    const filters = parseFilters(parsed.filters);
    const periods = await periodsInRange(tenantId, parsed.frequency, parsed.from, parsed.to);
    const periodIds = periods.map((p) => p.id);

    // Refuse before locking anything if the file could not be written as asked.
    const check = await buildAdpEpi({ tenantId, payPeriodIds: periodIds, filters, codes: parsed.codes, mode: "preview" });
    if (check.summary.employees === 0) throw new Error("Nobody with hours matches these filters.");
    if (check.summary.needsDoubleTimeCode) throw new Error("Some hours are double time. Enter the ADP code for double time.");
    if (check.summary.needsMealPenaltyCode) throw new Error("Some hours are meal penalties. Enter the ADP code for meal penalty.");
    const missedInFile = check.summary.missedPunches.filter((m) => !m.excluded);
    if (missedInFile.length > 0 && !parsed.acknowledgeMissedPunches) {
      throw new Error(
        `${missedInFile.length} ${missedInFile.length === 1 ? "timecard has" : "timecards have"} open missed punches. Preview again and confirm to process anyway.`,
      );
    }

    // Left out for a missed punch: their timecards stay unlocked to be corrected.
    const leftOut = check.summary.missedPunches.filter((m) => m.excluded);
    const inRun = await periodsInRun(tenantId, periodIds, withoutMissedPunchFilter(filters));
    const toLock = periods.filter((p) => inRun.has(p.id) && p.status !== "LOCKED");
    for (const p of toLock) {
      await lockPeriod(p.id, ctx, leftOut.filter((m) => m.payPeriodId === p.id).map((m) => m.timesheetId));
    }
    const leftOpen = leftOut.filter((m) => toLock.some((p) => p.id === m.payPeriodId)).length;

    const { csv, summary } = await buildAdpEpi({ tenantId, payPeriodIds: periodIds, filters, codes: parsed.codes, mode: "final" });
    const filename = `EPI${parsed.codes.coCode}01_${parsed.from.replace(/-/g, "")}_${parsed.to.replace(/-/g, "")}.csv`;

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
            frequency: parsed.frequency,
            from: parsed.from,
            to: parsed.to,
            coCode: parsed.codes.coCode,
            batchId: parsed.codes.batchId,
            filters: parsed.filters,
            employees: summary.employees,
            rows: summary.rows,
            lockedByThisRun: toLock.some((t) => t.id === p.id),
            openMissedPunchesInFile: missedInFile.filter((m) => m.payPeriodId === p.id).length,
            leftOutForMissedPunches: leftOut.filter((m) => m.payPeriodId === p.id).length,
          },
        },
      });
    }

    return { csv, filename, summary, locked: toLock.length, leftOpen };
  },
);

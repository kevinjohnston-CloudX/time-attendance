import { db } from "@/lib/db";
import type { ExceptionType, PayBucket, Prisma } from "@prisma/client";

/**
 * The ADP Workforce Now EPI batch import file for one pay period's dates.
 *
 * <p>Hours are read from each timecard's paid work segments and placed by
 * pay code first, then by hours type:
 * - a meal premium is always the meal penalty code;
 * - a pay code outside the regular bucket (holiday, PTO, sick, bereavement...)
 *   is written under its own export code, even when it sits on worked hours;
 * - regular-type pay codes (Regular Hours, Salary...) and uncoded hours go to
 *   Reg Hours, O/T Hours, or the double time code by the segment's bucket;
 * - unpaid time (unpaid meals, unpaid time off) is left out.
 * File # is the employee's Badge ID. A person with no Badge ID is skipped.
 *
 * <p>Open exceptions never keep anyone out on their own; they are counted for
 * the preview. Only `excludeMissedPunches` leaves out a timecard with an open
 * missed punch, for a run that pays everyone else first.
 */

/** Each list narrows the run to those values; an empty list means all. */
export type EpiFilters = {
  badgeIds?: string[];
  ruleSetIds?: string[];
  payCategoryIds?: string[];
  siteIds?: string[];
  departmentIds?: string[];
  agencyIds?: string[];
  excludeMissedPunches?: boolean;
};

const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  MISSING_PUNCH: "Missed punch",
  LONG_SHIFT: "Long shift",
  SHORT_BREAK: "Short break",
  MISSED_MEAL: "Missed meal",
  UNSCHEDULED_OT: "Unscheduled overtime",
  CONSECUTIVE_DAYS: "Consecutive days",
  ABSENT: "Absent",
  LATE_IN: "Late in",
  EARLY_OUT: "Early out",
  SCAN_DISCREPANCY: "Scan discrepancy",
};

/** One timecard in the run with open missed punches. */
export type MissedPunchCard = {
  name: string;
  file: string;
  employeeId: string;
  payPeriodId: string;
  timesheetId: string;
  count: number;
  /** Left out of the file by the missed punch filter. */
  excluded: boolean;
};

export type EpiCodes = {
  coCode: string;
  batchId: string;
  doubleTimeCode: string;
  mealPenaltyCode: string;
};

export type EpiSummary = {
  employees: number;
  rows: number;
  regMinutes: number;
  otMinutes: number;
  byCode: { code: string; minutes: number }[];
  noBadge: { name: string; minutes: number }[];
  leftOut: { label: string; minutes: number; people: number }[];
  unlockedLeftOut: number;
  needsDoubleTimeCode: boolean;
  needsMealPenaltyCode: boolean;
  /** Open exceptions on the timecards in the run, by type, most first. */
  openExceptions: { type: ExceptionType; label: string; count: number; people: number }[];
  /** Timecards with open missed punches, by name. */
  missedPunches: MissedPunchCard[];
};

const HEADERS = [
  "Co Code", "Batch ID", "File #", "Shift",
  "Reg Hours", "O/T Hours",
  "Hours 3 Code", "Hours 3 Amount",
  "Hours 4 Code", "Hours 4 Amount",
  "Memo Code", "Memo Amount",
  "Reg Earnings", "O/T Earnings",
  "Earnings 3 Code", "Earnings 3 Amount",
  "Earnings 4 Code", "Earnings 4 Amount",
  "Earnings 5 Code", "Earnings 5 Amount",
  "Temp Dept", "Rate Code", "Temp Rate",
  "Adjust Ded Code", "Adjust Ded Amount",
  "Hours 3 Code", "Hours 3 Amount",
  "Hours 3 Code", "Hours 3 Amount",
  "Hours 3 Code", "Hours 3 Amount",
];

const COL = { co: 0, batch: 1, file: 2, reg: 4, ot: 5, h3Code: 6, h3Amount: 7 };

/** Buckets whose uncoded hours have no leave code to fall back to. */
const NO_FALLBACK = new Set<PayBucket>(["REG", "OT", "DT", "UNPAID"]);

function esc(val: string): string {
  return /[",\r\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
}

/** Hours to two places, trailing zeros dropped, as ADP's samples write them. */
function hours(minutes: number): string {
  return minutes ? parseFloat((minutes / 60).toFixed(2)).toString() : "";
}

export function employeeWhere(tenantId: string, f: EpiFilters): Prisma.EmployeeWhereInput {
  return {
    tenantId,
    ...(f.badgeIds?.length ? { wmsId: { in: f.badgeIds } } : {}),
    ...(f.ruleSetIds?.length ? { ruleSetId: { in: f.ruleSetIds } } : {}),
    ...(f.payCategoryIds?.length ? { payCategoryId: { in: f.payCategoryIds } } : {}),
    ...(f.siteIds?.length ? { siteId: { in: f.siteIds } } : {}),
    ...(f.departmentIds?.length ? { departmentId: { in: f.departmentIds } } : {}),
    ...(f.agencyIds?.length ? { agencyId: { in: f.agencyIds } } : {}),
  };
}

export async function buildAdpEpi(opts: {
  tenantId: string;
  payPeriodIds: string[];
  filters: EpiFilters;
  codes: EpiCodes;
  /**
   * "final" exports locked timecards only: a timecard unlocked for a correction
   * stays out. "preview" counts what Process would export: every timecard in a
   * period it is about to lock, and the locked ones in periods already locked.
   */
  mode: "preview" | "final";
}): Promise<{ csv: string; summary: EpiSummary }> {
  const { tenantId, payPeriodIds, filters, codes, mode } = opts;

  const [payCodes, timesheets] = await Promise.all([
    db.payCode.findMany({
      where: { tenantId },
      select: { id: true, code: true, label: true, expressCode: true, payBucket: true, isActive: true },
      orderBy: { code: "asc" },
    }),
    db.timesheet.findMany({
      where: { payPeriodId: { in: payPeriodIds }, employee: employeeWhere(tenantId, filters) },
      select: {
        id: true,
        employeeId: true,
        payPeriodId: true,
        status: true,
        payPeriod: { select: { status: true } },
        employee: { select: { wmsId: true, user: { select: { name: true } } } },
        exceptions: { where: { resolvedAt: null }, select: { exceptionType: true } },
        segments: {
          where: { isPaid: true, durationMinutes: { gt: 0 } },
          select: { durationMinutes: true, payBucket: true, payBucketOverride: true, segmentType: true, payCodeId: true },
        },
      },
    }),
  ]);

  const codeById = new Map(payCodes.map((c) => [c.id, c]));
  const bucketDefault = new Map<PayBucket, string>();
  for (const c of payCodes) {
    if (c.isActive && c.payBucket && c.expressCode && !NO_FALLBACK.has(c.payBucket) && !bucketDefault.has(c.payBucket)) {
      bucketDefault.set(c.payBucket, c.expressCode);
    }
  }

  type Person = { file: string; reg: number; ot: number; codes: Map<string, number> };
  const people = new Map<string, Person>();
  const noBadge = new Map<string, number>();
  const leftOut = new Map<string, { minutes: number; people: Set<string> }>();
  let unlockedLeftOut = 0;
  let dtMinutes = 0;
  let mpMinutes = 0;
  const exceptionCounts = new Map<ExceptionType, { count: number; people: Set<string> }>();
  const missedPunches: MissedPunchCard[] = [];

  for (const ts of timesheets) {
    const exported = ts.status === "LOCKED" || (mode === "preview" && ts.payPeriod.status !== "LOCKED");
    if (!exported) {
      if (ts.segments.length > 0) unlockedLeftOut++;
      continue;
    }

    const name = ts.employee.user?.name ?? "Unknown";
    const file = ts.employee.wmsId?.trim();

    // Counted only for people who can be in the file at all, and before the
    // hours check: a missed punch can leave a timecard with no paid hours.
    if (file) {
      for (const e of ts.exceptions) {
        const c = exceptionCounts.get(e.exceptionType) ?? { count: 0, people: new Set<string>() };
        c.count++;
        c.people.add(file);
        exceptionCounts.set(e.exceptionType, c);
      }
      const missed = ts.exceptions.filter((e) => e.exceptionType === "MISSING_PUNCH").length;
      if (missed > 0) {
        const excluded = Boolean(filters.excludeMissedPunches);
        missedPunches.push({ name, file, employeeId: ts.employeeId, payPeriodId: ts.payPeriodId, timesheetId: ts.id, count: missed, excluded });
        if (excluded) continue;
      }
    }
    if (ts.segments.length === 0) continue;
    const person: Person = file
      ? people.get(file) ?? { file, reg: 0, ot: 0, codes: new Map() }
      : { file: "", reg: 0, ot: 0, codes: new Map() };
    const addCode = (code: string, m: number) => person.codes.set(code, (person.codes.get(code) ?? 0) + m);
    const leave = (label: string, m: number) => {
      const e = leftOut.get(label) ?? { minutes: 0, people: new Set<string>() };
      e.minutes += m;
      e.people.add(file || name);
      leftOut.set(label, e);
    };

    for (const seg of ts.segments) {
      const m = seg.durationMinutes;
      const bucket = (seg.payBucketOverride ?? seg.payBucket) as PayBucket;
      const pc = seg.payCodeId ? codeById.get(seg.payCodeId) : undefined;

      if (seg.segmentType === "MEAL_PREMIUM") {
        mpMinutes += m;
        addCode(codes.mealPenaltyCode, m);
        continue;
      }
      if (pc && pc.payBucket && pc.payBucket !== "REG") {
        if (pc.payBucket === "UNPAID") continue;
        if (pc.expressCode) addCode(pc.expressCode, m);
        else leave(`${pc.label} (pay code ${pc.code} has no Express code)`, m);
        continue;
      }
      if (bucket === "REG") person.reg += m;
      else if (bucket === "OT") person.ot += m;
      else if (bucket === "DT") { dtMinutes += m; addCode(codes.doubleTimeCode, m); }
      else if (bucket === "UNPAID") continue;
      else {
        const fallback = bucketDefault.get(bucket);
        if (fallback) addCode(fallback, m);
        else leave(`${bucket} hours with no pay code`, m);
      }
    }

    const total = person.reg + person.ot + [...person.codes.values()].reduce((a, b) => a + b, 0);
    if (!file) {
      if (total > 0) noBadge.set(name, (noBadge.get(name) ?? 0) + total);
      continue;
    }
    people.set(file, person);
  }

  const rows: string[][] = [];
  const byCode = new Map<string, number>();
  let regMinutes = 0;
  let otMinutes = 0;
  const sorted = [...people.values()]
    .filter((p) => p.reg + p.ot + [...p.codes.values()].reduce((a, b) => a + b, 0) > 0)
    .sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));

  for (const p of sorted) {
    regMinutes += p.reg;
    otMinutes += p.ot;
    const extra = [...p.codes.entries()].filter(([, m]) => m > 0);
    for (const [code, m] of extra) byCode.set(code, (byCode.get(code) ?? 0) + m);

    // One line per File #, then one more line per additional hours code.
    const lines = Math.max(1, extra.length);
    for (let i = 0; i < lines; i++) {
      const row = new Array<string>(HEADERS.length).fill("");
      row[COL.co] = codes.coCode;
      row[COL.batch] = codes.batchId;
      row[COL.file] = p.file;
      if (i === 0) {
        row[COL.reg] = hours(p.reg);
        row[COL.ot] = hours(p.ot);
      }
      if (extra[i]) {
        row[COL.h3Code] = extra[i][0];
        row[COL.h3Amount] = hours(extra[i][1]);
      }
      rows.push(row);
    }
  }

  const csv = [HEADERS, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");

  return {
    csv,
    summary: {
      employees: sorted.length,
      rows: rows.length,
      regMinutes,
      otMinutes,
      byCode: [...byCode.entries()].map(([code, minutes]) => ({ code, minutes })).sort((a, b) => b.minutes - a.minutes),
      noBadge: [...noBadge.entries()].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => a.name.localeCompare(b.name)),
      leftOut: [...leftOut.entries()].map(([label, v]) => ({ label, minutes: v.minutes, people: v.people.size })),
      unlockedLeftOut,
      needsDoubleTimeCode: dtMinutes > 0 && !codes.doubleTimeCode.trim(),
      needsMealPenaltyCode: mpMinutes > 0 && !codes.mealPenaltyCode.trim(),
      openExceptions: [...exceptionCounts.entries()]
        .map(([type, v]) => ({ type, label: EXCEPTION_LABEL[type], count: v.count, people: v.people.size }))
        .sort((a, b) => b.count - a.count),
      missedPunches: missedPunches.sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

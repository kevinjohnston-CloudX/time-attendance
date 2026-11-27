import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

/**
 * Recalculating the open timecards a settings change moves.
 *
 * <p>Changing a rule set, shift, holiday rule, holiday or pay code changes how
 * hours are worked out, but nothing recalculated the timecards already holding
 * hours: they kept the old figures until the 6 AM job, or until somebody
 * touched each one. Now the save recalculates them straight after it answers,
 * in the background, so the person saving is not kept waiting.
 *
 * <p>Gentle on a database other people are working in: two at a time, newest
 * pay period first, and it stops after a few minutes. Whatever is left is
 * picked up by the 6 AM job, which recalculates every open timecard anyway.
 * Each recalculation is all or nothing (rebuildSegments), so stopping part way
 * never leaves a timecard half done.
 *
 * <p>The same timecards the 6 AM job would recalculate: open pay periods, not
 * locked or approved for payroll, people still active. An inactive person's
 * timecards stay as they were when they left.
 */

/** Which open timecards a change reaches, inside its company. */
export type ChangedSetting =
  | { kind: "ruleSet"; id: string }
  | { kind: "shift"; id: string }
  | { kind: "holidayRule"; id: string }
  | { kind: "payCode"; id: string }
  | { kind: "holiday"; dates: Date[] };

const AT_ONCE = 2;
const TIME_LIMIT_MS = 180_000;

function reached(change: ChangedSetting): Prisma.TimesheetWhereInput {
  switch (change.kind) {
    case "ruleSet":
      return { employee: { ruleSetId: change.id } };
    case "shift":
      return { employee: { shiftId: change.id } };
    case "holidayRule":
      return { employee: { holidayRuleId: change.id } };
    case "payCode":
      return {
        OR: [
          { punches: { some: { payCodeId: change.id } } },
          { segments: { some: { payCodeId: change.id } } },
        ],
      };
    case "holiday":
      // The pay periods holding the day (the end date is stored exclusive),
      // for people a holiday can credit at all.
      return {
        employee: { holidayRuleId: { not: null } },
        OR: change.dates.map((d) => ({ payPeriod: { startDate: { lte: d }, endDate: { gt: d } } })),
      };
  }
}

/** Recalculates the open timecards a change reaches, now. Returns what it did. */
export async function recalculateOpenTimecards(tenantId: string, change: ChangedSetting) {
  const sheets = await db.timesheet.findMany({
    where: {
      AND: [
        reached(change),
        {
          employee: { tenantId, isActive: true },
          payPeriod: { status: "OPEN" },
          status: { notIn: ["LOCKED", "PAYROLL_APPROVED"] },
        },
      ],
    },
    select: { id: true, employee: { select: { ruleSet: true } } },
    orderBy: { payPeriod: { startDate: "desc" } },
  });

  const started = Date.now();
  let done = 0;
  let failed = 0;
  let i = 0;
  for (; i < sheets.length && Date.now() - started < TIME_LIMIT_MS; i += AT_ONCE) {
    const batch = sheets.slice(i, i + AT_ONCE);
    const results = await Promise.allSettled(batch.map((s) => rebuildSegments(s.id, s.employee.ruleSet)));
    for (const r of results) {
      if (r.status === "fulfilled") done++;
      else failed++;
    }
  }
  const left = Math.max(0, sheets.length - i);
  console.log(
    `recalculate-open: ${change.kind} change, ${done} of ${sheets.length} timecards recalculated` +
      (failed ? `, ${failed} failed` : "") +
      (left ? `, ${left} left for the 6 AM job` : ""),
  );
  return { total: sheets.length, done, failed, left };
}

/**
 * Recalculates the open timecards a change reaches once the save has answered.
 * A failure is logged, never thrown at the person who saved: their change is
 * saved either way, and the 6 AM job recalculates again.
 */
export function recalculateOpenTimecardsAfterSave(tenantId: string, change: ChangedSetting): void {
  after(async () => {
    try {
      await recalculateOpenTimecards(tenantId, change);
    } catch (err) {
      console.error("recalculate-open: failed after a settings change", change.kind, err);
    }
  });
}

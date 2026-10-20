import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { findOpenPayPeriod } from "@/lib/utils/punch-helpers";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { writeAuditLog } from "@/lib/audit/logger";
import type { RuleSet } from "@prisma/client";
import { personTimeZone } from "@/lib/utils/person-time-zone";

/** How far back a rule set change reaches: open timecards ending within this many days. */
const REACH_DAYS = 35;

/**
 * When someone's rule set changes, move their open timecards to the new rule
 * set's pay periods, one day at a time: every punch goes to the new rule
 * set's open period that holds its day at the site, and the day's notes,
 * reasons, waivers and exceptions go with it.
 *
 * <p>This used to move a timecard only when the new rule set had a period
 * with exactly the same start and end, so a change between schedules (a
 * California biweekly to a Georgia weekly, say) left the hours on the old
 * timecard, HR re-entered them on the new one, and the person was paid twice.
 *
 * <p>A timecard moves whole or not at all: if any of its days has no open
 * period to go to (not generated yet, or locked), or would land on a locked
 * timecard, it stays as it is, so no timecard is left half moved with its
 * moved days reading as absences. A punch HR has already entered on the new
 * timecard at the same time is voided rather than moved, so it is not paid
 * twice. The emptied old timecard is removed; the ones that received punches
 * are recalculated under the new rule set.
 *
 * <p>Safe to call when nothing needs moving: it then changes nothing.
 */
export async function moveTimecardsToRuleSet(employeeId: string, ruleSet: RuleSet, actorId: string | null): Promise<void> {
  const employee = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { tenantId: true, isActive: true, timeZone: true, site: { select: { timezone: true } } },
  });
  // An inactive person's timecards stay where they are: none is changed or
  // made after they leave.
  if (!employee.isActive) return;
  const timezone = personTimeZone(employee);
  const ownSchedule = Boolean(ruleSet.payFrequency && ruleSet.payPeriodAnchorDate);
  const dayOf = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);

  // The new rule set's open period for a day, or null. With a schedule of its
  // own it must be one of its periods: the lookup falls back to a company
  // period when the rule set has none for the day, and that is the wrong place.
  const periodForDay = new Map<string, string | null>();
  const destinationPeriod = async (day: string) => {
    if (!periodForDay.has(day)) {
      const p = await findOpenPayPeriod(employee.tenantId, ruleSet.id, { at: new Date(`${day}T12:00:00Z`), timezone });
      periodForDay.set(day, p && (!ownSchedule || p.ruleSetId === ruleSet.id) ? p.id : null);
    }
    return periodForDay.get(day)!;
  };

  const cards = await db.timesheet.findMany({
    where: {
      employeeId,
      status: { notIn: ["LOCKED", "PAYROLL_APPROVED"] },
      payPeriod: { status: "OPEN", endDate: { gte: new Date(Date.now() - REACH_DAYS * 86_400_000) } },
    },
    select: { id: true, payPeriodId: true },
  });

  const recalculate = new Set<string>();
  for (const card of cards) {
    const [punches, notes, reasons, mealWaivers, premiumWaivers, exceptions, timeOff] = await Promise.all([
      db.punch.findMany({ where: { timesheetId: card.id }, orderBy: { punchTime: "asc" } }),
      db.timesheetNote.findMany({ where: { timesheetId: card.id }, select: { id: true, noteDate: true } }),
      db.timesheetDayReason.findMany({ where: { timesheetId: card.id }, select: { segmentDate: true } }),
      db.mealWaiver.findMany({ where: { timesheetId: card.id }, select: { id: true, segmentDate: true } }),
      db.mealPremiumWaiver.findMany({ where: { timesheetId: card.id }, select: { id: true, segmentDate: true, segmentStart: true } }),
      db.exception.findMany({ where: { timesheetId: card.id }, select: { id: true, occurredAt: true } }),
      // Time off (leave requests, hours entered with a leave code) and the
      // zero-hour pay code markers on absent days live only as LEAVE lines: a
      // recalculation keeps them and never makes them from punches, so they
      // move with their day. Every other line is rebuilt by the recalculation.
      db.workSegment.findMany({ where: { timesheetId: card.id, segmentType: "LEAVE" }, select: { id: true, segmentDate: true } }),
    ]);
    if (punches.length === 0 && timeOff.length === 0) continue;

    // Where each day goes. Stored dates are the day itself; a moment is read at the site.
    const days = new Set<string>([
      ...punches.map((p) => dayOf(p.punchTime)),
      ...notes.map((n) => n.noteDate.toISOString().slice(0, 10)),
      ...reasons.map((r) => r.segmentDate.toISOString().slice(0, 10)),
      ...mealWaivers.map((w) => w.segmentDate.toISOString().slice(0, 10)),
      ...premiumWaivers.map((w) => w.segmentDate.toISOString().slice(0, 10)),
      ...timeOff.map((s) => s.segmentDate.toISOString().slice(0, 10)),
    ]);
    const target = new Map<string, string>();
    let movable = true;
    for (const day of days) {
      const periodId = await destinationPeriod(day);
      if (!periodId) { movable = false; break; }
      target.set(day, periodId);
    }
    if (!movable) continue;
    if ([...target.values()].every((id) => id === card.payPeriodId)) continue;

    const timesheetFor = new Map<string, string>();
    for (const periodId of new Set(target.values())) {
      const ts = await findOrCreateTimesheet(employeeId, periodId);
      if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") { movable = false; break; }
      timesheetFor.set(periodId, ts.id);
    }
    if (!movable) continue;
    const to = (day: string) => timesheetFor.get(target.get(day)!)!;
    const exceptionDay = (at: Date) => {
      const local = dayOf(at);
      return target.has(local) ? local : at.toISOString().slice(0, 10);
    };

    // A punch already on the new timecard at the same time: void the old copy.
    const destinationPunches = await db.punch.findMany({
      where: { timesheetId: { in: [...timesheetFor.values()] }, correctedById: null, correctsId: null, isRejected: false },
      select: { timesheetId: true, punchType: true, punchTime: true },
    });
    const twin = (p: (typeof punches)[number]) =>
      !p.correctedById && !p.correctsId && !p.isRejected &&
      destinationPunches.some((d) => d.timesheetId === to(dayOf(p.punchTime)) && d.punchType === p.punchType && d.punchTime.getTime() === p.punchTime.getTime());

    let moved = 0, voided = 0;
    await db.$transaction(async (tx) => {
      for (const p of punches) {
        const dest = to(dayOf(p.punchTime));
        if (twin(p)) {
          const tomb = await tx.punch.create({
            data: {
              employeeId, timesheetId: dest, punchType: p.punchType, punchTime: p.punchTime, roundedTime: p.roundedTime,
              source: "MANUAL", stateBefore: p.stateBefore, stateAfter: p.stateAfter, isApproved: false,
              approvedById: actorId, approvedAt: new Date(), note: "VOID: Already on the new rule set's timecard", correctsId: p.id,
            },
          });
          await tx.punch.update({ where: { id: p.id }, data: { timesheetId: dest, correctedById: tomb.id } });
          voided++;
        } else {
          await tx.punch.update({ where: { id: p.id }, data: { timesheetId: dest } });
          if (!p.correctsId) moved++;
        }
      }
      for (const n of notes) await tx.timesheetNote.update({ where: { id: n.id }, data: { timesheetId: to(n.noteDate.toISOString().slice(0, 10)) } });
      // One per day on a timecard: the new timecard's own wins.
      for (const r of reasons) {
        const dest = to(r.segmentDate.toISOString().slice(0, 10));
        const taken = await tx.timesheetDayReason.findUnique({ where: { timesheetId_segmentDate: { timesheetId: dest, segmentDate: r.segmentDate } } });
        if (taken) await tx.timesheetDayReason.delete({ where: { timesheetId_segmentDate: { timesheetId: card.id, segmentDate: r.segmentDate } } });
        else await tx.timesheetDayReason.update({ where: { timesheetId_segmentDate: { timesheetId: card.id, segmentDate: r.segmentDate } }, data: { timesheetId: dest } });
      }
      for (const w of mealWaivers) {
        const dest = to(w.segmentDate.toISOString().slice(0, 10));
        const taken = await tx.mealWaiver.findUnique({ where: { timesheetId_segmentDate: { timesheetId: dest, segmentDate: w.segmentDate } } });
        if (taken) await tx.mealWaiver.delete({ where: { id: w.id } });
        else await tx.mealWaiver.update({ where: { id: w.id }, data: { timesheetId: dest } });
      }
      for (const w of premiumWaivers) {
        const dest = to(w.segmentDate.toISOString().slice(0, 10));
        const taken = await tx.mealPremiumWaiver.findUnique({ where: { timesheetId_segmentStart: { timesheetId: dest, segmentStart: w.segmentStart } } });
        if (taken) await tx.mealPremiumWaiver.delete({ where: { id: w.id } });
        else await tx.mealPremiumWaiver.update({ where: { id: w.id }, data: { timesheetId: dest } });
      }
      // Exceptions follow their day; the recalculation resolves the ones that no longer apply.
      for (const x of exceptions) {
        const day = exceptionDay(x.occurredAt);
        if (target.has(day)) await tx.exception.update({ where: { id: x.id }, data: { timesheetId: to(day) } });
        else await tx.exception.delete({ where: { id: x.id } });
      }
      for (const s of timeOff) await tx.workSegment.update({ where: { id: s.id }, data: { timesheetId: to(s.segmentDate.toISOString().slice(0, 10)) } });
      await tx.workSegment.deleteMany({ where: { timesheetId: card.id } });
      await tx.overtimeBucket.deleteMany({ where: { timesheetId: card.id } });
      await tx.timesheet.delete({ where: { id: card.id } });
    });

    await writeAuditLog({
      tenantId: employee.tenantId,
      actorId: actorId ?? undefined,
      action: "TIMESHEET_MOVED",
      entityType: "TIMESHEET",
      entityId: card.id,
      changes: {
        fields: [
          { field: "Rule set", before: "Previous rule set", after: ruleSet.name },
          { field: "Punches moved", before: null, after: String(moved) },
          ...(voided ? [{ field: "Punches already on the new timecard (voided)", before: null, after: String(voided) }] : []),
        ],
        days: [...target.keys()].sort(),
        to: [...new Set(timesheetFor.values())],
      },
    });
    timesheetFor.forEach((id) => recalculate.add(id));
  }

  for (const id of recalculate) await rebuildSegments(id, ruleSet).catch(() => {});
}

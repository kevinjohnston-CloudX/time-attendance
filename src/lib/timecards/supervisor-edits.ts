import type { Prisma, TimecardEditKind } from "@prisma/client";
import { db } from "@/lib/db";
import { checkPermission } from "@/lib/rbac/check-permission";
import { TIMECARD_EDITORS } from "@/lib/rbac/permissions";
import { dayAt, noteTimecardChange } from "@/lib/timecards/change-note";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import {
  addTimeRefusal,
  describeEditItem,
  isRegularCode,
  mealWaiverRefusal,
  punchChangeRefusal,
  SALARIED_ERROR,
  SUPERVISOR_EDITS_OFF_ERROR,
  type EditItemInput,
  type RowPunch,
} from "@/lib/timecards/supervisor-edit-rules";

/**
 * Supervisors' timecard changes, sent to HR for approval (11/11).
 *
 * <p>A site switches them on (Site.supervisorTimecardEdits). Off, a supervisor
 * there makes no timecard change at all; on, what they save becomes a
 * TimecardEditRequest and nothing on the timecard moves until HR approves it
 * (timecard-edit.actions applies it). supervisor-edit-rules has what they may
 * change; this is the part that reads the database.
 */

/**
 * Whether the caller's timecard changes go to HR: they came in on the
 * supervisors' permission (PUNCH_FIX_MISSED_TEAM) and have none of the
 * editors'. For an action that let them in through MISSED_PUNCH_FIXERS.
 */
export async function editsNeedApproval(): Promise<boolean> {
  for (const p of TIMECARD_EDITORS) if (await checkPermission(p)) return false;
  return true;
}

/** Whether supervisors may edit this person's timecards: their site's switch. */
export async function supervisorEditsOn(employeeId: string): Promise<boolean> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { site: { select: { supervisorTimecardEdits: true } } } });
  return !!e?.site.supervisorTimecardEdits;
}

/**
 * Throws unless supervisors may edit this person's timecards: their site's
 * switch is on, and they are paid by the hour. A salaried person's days are
 * Salary hours, not regular hours, so theirs stay with HR and payroll.
 */
export async function assertSupervisorEditsOn(employeeId: string): Promise<void> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { payType: true, site: { select: { supervisorTimecardEdits: true } } } });
  if (!e?.site.supervisorTimecardEdits) throw new Error(SUPERVISOR_EDITS_OFF_ERROR);
  if (e.payType === "SALARY") throw new Error(SALARIED_ERROR);
}

const PENDING_ITEM: Prisma.TimecardEditItemWhereInput = { status: "PENDING", request: { status: "PENDING" } };

export { assertNoPendingEdits } from "@/lib/timecards/pending-edits";

/** The timecard as the rules read it: punches, codes, days, and what already waits. */
export async function timecardForEdits(timesheetId: string) {
  const [sheet, punches, markers, pending] = await Promise.all([
    db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      select: {
        id: true,
        status: true,
        employeeId: true,
        employee: { select: { timeZone: true, site: { select: { timezone: true } }, ruleSet: { select: { defaultPayCodeId: true } } } },
      },
    }),
    db.punch.findMany({
      where: { timesheetId, isApproved: true, correctedById: null },
      select: { id: true, punchType: true, roundedTime: true, payCodeId: true, hoursOnly: true },
    }),
    // Hours, or a day, on a pay code: a day with any on another code than
    // regular hours is that code's day (PTO, FMLA, Salary, a code HR put on
    // a day with no hours), and supervisors leave it to HR.
    db.workSegment.findMany({
      where: { timesheetId, segmentType: { in: ["WORK", "LEAVE"] }, payCodeId: { not: null } },
      select: { segmentDate: true, payCodeId: true, payCode: { select: { code: true } } },
    }),
    db.timecardEditItem.findMany({ where: { ...PENDING_ITEM, request: { status: "PENDING", timesheetId } }, select: { punchId: true } }),
  ]);
  const regularCodeId = sheet.employee.ruleSet.defaultPayCodeId ?? null;
  const timeZone = personTimeZone(sheet.employee, "UTC");
  // A segment's date is the person's own day, stored at midnight UTC.
  const codedDays = new Set(
    markers
      .filter((m) => !isRegularCode(m.payCodeId, regularCodeId) && !(regularCodeId === null && m.payCode?.code === 0))
      .map((m) => m.segmentDate.toISOString().slice(0, 10)),
  );
  const otherCodeDays = new Set([
    ...codedDays,
    ...punches.filter((p) => p.punchType === "CLOCK_IN" && !isRegularCode(p.payCodeId, regularCodeId)).map((p) => dayAt(p.roundedTime, timeZone)),
  ]);
  return {
    sheet,
    punches,
    rows: punches as RowPunch[],
    regularCodeId,
    timeZone,
    codedDays,
    otherCodeDays,
    today: dayAt(new Date(), timeZone),
    pendingPunchIds: new Set(pending.map((p) => p.punchId).filter(Boolean) as string[]),
  };
}

type Timecard = Awaited<ReturnType<typeof timecardForEdits>>;

/** A change as it is kept (TimecardEditItem), before it is saved. */
export type EditItemData = {
  kind: TimecardEditKind;
  punchId?: string | null;
  exceptionId?: string | null;
  punchType?: string | null;
  at?: Date | null;
  endAt?: Date | null;
  before?: Date | null;
  day: Date;
  minutes?: number | null;
  waive?: boolean | null;
};

const asDay = (day: string) => new Date(day + "T00:00:00.000Z");

/** Checks one change against the rules and the timecard, and turns it into what is kept. Throws why not. */
export function resolveEditItem(tc: Timecard, input: EditItemInput): EditItemData {
  const refuse = (why: string | null) => { if (why) throw new Error(why); };
  const base = { punches: tc.rows, regularCodeId: tc.regularCodeId, today: tc.today, codedDays: tc.codedDays };
  const savedPunch = (punchId: string) => {
    const p = tc.punches.find((x) => x.id === punchId);
    if (!p) throw new Error("That punch has changed since the page loaded. Reload the page and try again.");
    if (p.hoursOnly) throw new Error("Hours entered with Add time are changed by HR or payroll.");
    if (tc.pendingPunchIds.has(punchId)) throw new Error("A change to this punch already waits for HR. Change that one instead.");
    return p;
  };
  switch (input.kind) {
    case "ADD_PUNCH": {
      const at = new Date(input.at);
      const day = dayAt(at, tc.timeZone);
      refuse(punchChangeRefusal({ ...base, landing: [at], days: [day] }));
      return { kind: "ADD_PUNCH", punchType: input.punchType, at, day: asDay(day) };
    }
    case "CHANGE_PUNCH": {
      const p = savedPunch(input.punchId);
      const at = new Date(input.at);
      const day = dayAt(at, tc.timeZone);
      refuse(punchChangeRefusal({ ...base, punch: p as RowPunch, landing: [at], days: [day] }));
      return { kind: "CHANGE_PUNCH", punchId: p.id, punchType: p.punchType, at, before: p.roundedTime, day: asDay(dayAt(p.roundedTime, tc.timeZone)) };
    }
    case "REMOVE_PUNCH": {
      const p = savedPunch(input.punchId);
      refuse(punchChangeRefusal({ ...base, punch: p as RowPunch, landing: [], days: [] }));
      return { kind: "REMOVE_PUNCH", punchId: p.id, punchType: p.punchType, before: p.roundedTime, day: asDay(dayAt(p.roundedTime, tc.timeZone)) };
    }
    case "ADD_PAIR": {
      const at = new Date(input.at);
      const endAt = new Date(input.endAt);
      refuse(addTimeRefusal({ status: tc.sheet.status, day: input.day, today: tc.today, codedDays: tc.codedDays, pair: { at, endAt } }));
      return { kind: "ADD_PAIR", at, endAt, day: asDay(input.day) };
    }
    case "ADD_HOURS": {
      refuse(addTimeRefusal({ status: tc.sheet.status, day: input.day, today: tc.today, codedDays: tc.codedDays, minutes: input.minutes }));
      return { kind: "ADD_HOURS", minutes: Math.round(input.minutes), day: asDay(input.day) };
    }
    case "MEAL_WAIVER": {
      refuse(mealWaiverRefusal({ day: input.day, today: tc.today, otherCodeDays: tc.otherCodeDays }));
      return { kind: "MEAL_WAIVER", waive: input.waive, day: asDay(input.day) };
    }
  }
}

/**
 * Keeps a supervisor's changes as one request for HR, one per Save, and notes
 * each day they touch. The caller has checked the supervisor may act on this
 * timecard (scope, not their own, editable) and that the site's switch is on.
 */
export async function sendEditsForApproval(o: {
  tenantId: string;
  timesheetId: string;
  submittedById: string;
  reason: string;
  items: EditItemData[];
  timeZone: string;
}): Promise<{ requestId: string }> {
  if (o.items.length === 0) throw new Error("There are no changes to send.");
  const request = await db.timecardEditRequest.create({
    data: {
      tenantId: o.tenantId,
      timesheetId: o.timesheetId,
      submittedById: o.submittedById,
      reason: o.reason,
      items: { create: o.items },
    },
    select: { id: true },
  });
  const byDay = new Map<string, string[]>();
  for (const item of o.items) {
    const day = item.day.toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), describeEditItem(item, o.timeZone)]);
  }
  for (const [day, changes] of byDay) {
    await noteTimecardChange({ timesheetId: o.timesheetId, day, actorId: o.submittedById, change: `Sent for HR approval: ${changes.join("; ")}`, note: o.reason });
  }
  return { requestId: request.id };
}

/**
 * Supervisors' changes on a timecard waiting for HR, as it shows them. Those
 * HR decided are not listed: the day's notes say what was approved or turned
 * down, and why (John, 11/11). `timeZone` is the person's, for the times in words.
 */
export async function editRequestsFor(timesheetId: string, timeZone: string) {
  const requests = await db.timecardEditRequest.findMany({
    where: { timesheetId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: {
      items: { where: { status: "PENDING" }, orderBy: { createdAt: "asc" } },
      submittedBy: { select: { user: { select: { name: true } }, employeeCode: true } },
    },
  });
  return requests.map((r) => ({
    id: r.id,
    status: r.status,
    submittedBy: r.submittedBy.user?.name ?? r.submittedBy.employeeCode,
    createdAt: r.createdAt.toISOString(),
    reason: r.reason,
    decisionNote: r.decisionNote,
    items: r.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      status: i.status,
      error: i.error,
      punchId: i.punchId,
      punchType: i.punchType,
      at: i.at?.toISOString() ?? null,
      endAt: i.endAt?.toISOString() ?? null,
      day: i.day.toISOString().slice(0, 10),
      minutes: i.minutes,
      waive: i.waive,
      text: describeEditItem(i, timeZone),
    })),
  }));
}

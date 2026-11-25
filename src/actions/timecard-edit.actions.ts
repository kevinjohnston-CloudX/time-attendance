"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { assertEditable, assertEmployeeInScope, employeeScope, timesheetInScope } from "@/lib/rbac/scope";
import { MISSED_PUNCH_FIXERS, TIMECARD_EDITORS, TIMECARD_EDITORS_COMPANY } from "@/lib/rbac/permissions";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import { writeAuditLog } from "@/lib/audit/logger";
import { dayAt, noteTimecardChange } from "@/lib/timecards/change-note";
import { describeEditItem, EDITS_CHANGED_ERROR, editsSeen, type EditItemInput } from "@/lib/timecards/supervisor-edit-rules";
import {
  assertSupervisorEditsOn,
  editRequestsFor,
  editsNeedApproval,
  resolveEditItem,
  sendEditsForApproval,
  timecardForEdits,
} from "@/lib/timecards/supervisor-edits";
import { approveMissedPunch, correctPunch, deletePunch } from "@/actions/punch.actions";
import { addManualHoursEntry, addManualPunchPair, addManualPunches } from "@/actions/timecard-entry.actions";
import { toggleMealWaiver } from "@/actions/timesheet.actions";
import { dateFormat } from "@/lib/utils/date-format";

/**
 * Supervisors' timecard changes, sent to HR (11/11), and HR's decision on
 * them. lib/timecards/supervisor-edits has the rules and the keeping; this is
 * where they are sent, revised, withdrawn, and approved or rejected.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moment = z.string().datetime({ offset: true });
const itemSchema: z.ZodType<EditItemInput> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ADD_PUNCH"), punchType: z.enum(["CLOCK_IN", "CLOCK_OUT"]), at: moment }),
  z.object({ kind: z.literal("CHANGE_PUNCH"), punchId: z.string().min(1), at: moment }),
  z.object({ kind: z.literal("REMOVE_PUNCH"), punchId: z.string().min(1) }),
  z.object({ kind: z.literal("ADD_PAIR"), day, at: moment, endAt: moment }),
  z.object({ kind: z.literal("ADD_HOURS"), day, minutes: z.number().int().positive().max(24 * 60) }),
  z.object({ kind: z.literal("MEAL_WAIVER"), day, waive: z.boolean() }),
]);

const HR_SAVES_DIRECTLY = "Managers, HR and payroll save timecard changes directly; only supervisors send them for approval.";

/** The timecard a supervisor sends changes for, made if there is none yet in the period. */
async function supervisorTimecard(ctx: Parameters<typeof timesheetInScope>[0], employeeId: string, periodId: string) {
  await assertEmployeeInScope(ctx, employeeId, ["TIMECARD_EDIT_ANY"]);
  if (employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");
  await assertSupervisorEditsOn(employeeId);
  const period = await db.payPeriod.findFirst({ where: { id: periodId, tenantId: ctx.tenantId ?? "" }, select: { id: true, status: true } });
  if (!period) throw new Error("This pay period isn't available. Reload the page and try again.");
  if (period.status !== "OPEN") throw new Error("This pay period is closed. Ask HR or payroll for this timecard.");
  const ts = await db.timesheet.upsert({
    where: { employeeId_payPeriodId: { employeeId, payPeriodId: periodId } },
    create: { employeeId, payPeriodId: periodId },
    update: {},
    select: { id: true, status: true },
  });
  assertEditable(ts.status);
  return ts;
}

// ─── Send ────────────────────────────────────────────────────────────────────

/**
 * Whether this supervisor may send changes for this person at all: on their
 * team, active, not themselves and not ranked above them. The timecard reads
 * it so the grid is read only where Save would be refused (Alex Admin, 11/11).
 */
export const canSendEditsFor = withRBAC(
  "PUNCH_FIX_MISSED_TEAM",
  async (ctx, input: { employeeId: string }): Promise<boolean> => {
    const { employeeId } = z.object({ employeeId: z.string().min(1) }).parse(input);
    if (employeeId === ctx.employeeId) return false;
    try {
      await assertEmployeeInScope(ctx, employeeId, ["TIMECARD_EDIT_ANY"]);
      await assertSupervisorEditsOn(employeeId);
      return true;
    } catch {
      return false;
    }
  },
);

export const submitTimecardEdits = withRBAC(
  "PUNCH_FIX_MISSED_TEAM",
  async (ctx, input: unknown): Promise<{ requestId: string; timesheetId: string }> => {
    const { employeeId, periodId, reason, items } = z.object({
      employeeId: z.string().min(1),
      periodId: z.string().min(1),
      reason: z.string().trim().min(1, "Give a reason for the changes, then save.").max(500),
      items: z.array(itemSchema).min(1).max(60),
    }).parse(input);
    if (!(await editsNeedApproval())) throw new Error(HR_SAVES_DIRECTLY);
    const ts = await supervisorTimecard(ctx, employeeId, periodId);

    const tc = await timecardForEdits(ts.id);
    const resolved = items.map((i) => resolveEditItem(tc, i));
    // One change per punch in a Save: two would apply one over the other.
    const punchIds = resolved.map((i) => i.punchId).filter(Boolean);
    if (new Set(punchIds).size !== punchIds.length) throw new Error("A punch is changed twice in these changes. Keep one, then save.");

    const { requestId } = await sendEditsForApproval({
      tenantId: ctx.tenantId!,
      timesheetId: ts.id,
      submittedById: ctx.employeeId!,
      reason,
      items: resolved,
      timeZone: tc.timeZone,
    });
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.employeeId,
      action: "TIMECARD_EDITS_SENT",
      entityType: "TIMESHEET",
      entityId: ts.id,
      changes: { after: { requestId, items: resolved.map((i) => describeEditItem(i, tc.timeZone)), reason } },
    });
    revalidatePath("/payroll/timecards");
    revalidatePath("/approvals");
    return { requestId, timesheetId: ts.id };
  },
);

/** A pending change, and the timecard it is on, if the caller may act on it. */
async function pendingItem(ctx: Parameters<typeof timesheetInScope>[0], itemId: string) {
  const item = await db.timecardEditItem.findUnique({
    where: { id: itemId },
    include: { request: { select: { id: true, status: true, timesheetId: true, submittedById: true } } },
  });
  if (!item || item.status !== "PENDING" || item.request.status !== "PENDING") {
    throw new Error("This change was already decided or taken back. Reload the page to see where it stands.");
  }
  const sheet = await timesheetInScope(ctx, item.request.timesheetId, TIMECARD_EDITORS_COMPANY);
  if (sheet.employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");
  return { item, sheet };
}

/**
 * Puts a pending change right before HR decides: a time typed wrong (7:13 for
 * 7:31) is the one change with the right time, not a second one.
 */
export const reviseTimecardEdit = withRBAC(
  "PUNCH_FIX_MISSED_TEAM",
  async (ctx, input: unknown): Promise<void> => {
    const { itemId, at, endAt, minutes } = z.object({
      itemId: z.string().min(1),
      at: moment.optional(),
      endAt: moment.optional(),
      minutes: z.number().int().positive().max(24 * 60).optional(),
    }).parse(input);
    if (!(await editsNeedApproval())) throw new Error(HR_SAVES_DIRECTLY);
    const { item, sheet } = await pendingItem(ctx, itemId);
    await assertSupervisorEditsOn(sheet.employeeId);
    const tc = await timecardForEdits(sheet.id);
    // The change itself is not a second one waiting on its punch.
    if (item.punchId) tc.pendingPunchIds.delete(item.punchId);
    const day = item.day.toISOString().slice(0, 10);
    const next = (() => {
      switch (item.kind) {
        case "ADD_PUNCH": return resolveEditItem(tc, { kind: "ADD_PUNCH", punchType: item.punchType as "CLOCK_IN" | "CLOCK_OUT", at: at ?? item.at!.toISOString() });
        case "CHANGE_PUNCH": return resolveEditItem(tc, { kind: "CHANGE_PUNCH", punchId: item.punchId!, at: at ?? item.at!.toISOString() });
        case "ADD_PAIR": return resolveEditItem(tc, { kind: "ADD_PAIR", day, at: at ?? item.at!.toISOString(), endAt: endAt ?? item.endAt!.toISOString() });
        case "ADD_HOURS": return resolveEditItem(tc, { kind: "ADD_HOURS", day, minutes: minutes ?? item.minutes! });
        default: throw new Error("This change has no time to change. Take it back and send a new one.");
      }
    })();
    const before = describeEditItem(item, tc.timeZone);
    await db.timecardEditItem.update({ where: { id: item.id }, data: { at: next.at ?? null, endAt: next.endAt ?? null, minutes: next.minutes ?? null, day: next.day } });
    const after = describeEditItem({ ...item, ...next }, tc.timeZone);
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.employeeId,
      action: "TIMECARD_EDIT_REVISED",
      entityType: "TIMESHEET",
      entityId: sheet.id,
      changes: { before: { change: before }, after: { change: after, requestId: item.request.id } },
    });
    await noteTimecardChange({ timesheetId: sheet.id, day, actorId: ctx.employeeId, change: `Changed what waits for approval: ${before} is now ${after}` });
    revalidatePath("/payroll/timecards");
    revalidatePath("/approvals");
  },
);

/** Settles a request once nothing in it waits: decided if HR decided any of it, withdrawn if the supervisor took it all back. */
async function settleRequest(requestId: string) {
  const items = await db.timecardEditItem.findMany({ where: { requestId }, select: { status: true } });
  if (items.some((i) => i.status === "PENDING")) return;
  const status = items.every((i) => i.status === "WITHDRAWN") ? "WITHDRAWN" : "DECIDED";
  await db.timecardEditRequest.update({ where: { id: requestId }, data: { status } });
}

/** A supervisor takes back a change before HR decides it. */
export const withdrawTimecardEdit = withRBAC(
  "PUNCH_FIX_MISSED_TEAM",
  async (ctx, input: unknown): Promise<void> => {
    const { itemId } = z.object({ itemId: z.string().min(1) }).parse(input);
    if (!(await editsNeedApproval())) throw new Error(HR_SAVES_DIRECTLY);
    const { item, sheet } = await pendingItem(ctx, itemId);
    const { timeZone } = await timecardForEdits(sheet.id);
    await db.timecardEditItem.update({ where: { id: item.id }, data: { status: "WITHDRAWN" } });
    await settleRequest(item.request.id);
    const change = describeEditItem(item, timeZone);
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.employeeId,
      action: "TIMECARD_EDIT_WITHDRAWN",
      entityType: "TIMESHEET",
      entityId: sheet.id,
      changes: { before: { change, requestId: item.request.id } },
    });
    await noteTimecardChange({ timesheetId: sheet.id, day: item.day.toISOString().slice(0, 10), actorId: ctx.employeeId, change: `Took back a change sent for approval: ${change}` });
    revalidatePath("/payroll/timecards");
    revalidatePath("/approvals");
  },
);

// ─── Decide ──────────────────────────────────────────────────────────────────

type Applied = { success: boolean; error?: string };
const outcome = async (run: Promise<{ success: true } | { success: false; error: string }>): Promise<Applied> => {
  try {
    const r = await run;
    return r.success ? { success: true } : { success: false, error: r.error };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "It could not be applied." };
  }
};

/**
 * HR decides every supervisor change waiting on a timecard at once (John,
 * 11/12: one person's pay period, not one Save at a time): all approved, or
 * all but those in `rejectItemIds`, which are turned down with `note` (the
 * supervisor reads it). Approved changes are applied through the actions HR's
 * own changes use, each with the reason its supervisor gave, in an order that
 * keeps them apart: times changed, punches removed, punches added (a day's
 * together), Add time, the employee's requests, then meal waivers. One refused
 * (the timecard changed meanwhile) is marked so, with why, and the others
 * still go in. Refused whole if a supervisor put a change right, or took one
 * back, after HR's page loaded (`seen`, editsSeen).
 */
export const decideTimesheetEdits = withRBAC(
  TIMECARD_EDITORS,
  async (ctx, input: unknown): Promise<{ approved: number; rejected: number; failed: { id: string; error: string }[] }> => {
    const { timesheetId, rejectItemIds, note, seen } = z.object({
      timesheetId: z.string().min(1),
      rejectItemIds: z.array(z.string().min(1)).max(200).default([]),
      note: z.string().trim().max(500).optional(),
      // The changes as HR saw them (editsSeen).
      seen: z.string().optional(),
    }).parse(input);
    if (await editsNeedApproval()) throw new Error("Only managers, payroll and HR approve supervisors' changes.");
    const requests = await db.timecardEditRequest.findMany({
      where: { timesheetId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: {
        items: { where: { status: "PENDING" }, orderBy: { createdAt: "asc" } },
        submittedBy: { select: { user: { select: { name: true } }, employeeCode: true } },
      },
    });
    const sender = (r: (typeof requests)[number]) => r.submittedBy.user?.name ?? r.submittedBy.employeeCode;
    const items = requests.flatMap((r) => r.items.map((i) => ({ ...i, sender: sender(r), reason: `${r.reason} (sent by ${sender(r)})` })));
    if (items.length === 0) {
      throw new Error("These changes were already decided or taken back. Reload the page to see where they stand.");
    }
    // Put right or taken back since HR opened it: HR decides what they saw, or nothing.
    if (seen !== undefined && seen !== editsSeen(items.map((i) => ({ id: i.id, updatedAt: i.updatedAt.toISOString() })))) {
      throw new Error(EDITS_CHANGED_ERROR);
    }
    const sheet = await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't approve changes to your own timecard. Ask another admin to do it.");
    assertEditable(sheet.status);
    const rejecting = new Set(rejectItemIds.filter((id) => items.some((i) => i.id === id)));
    if (rejecting.size > 0 && !note) throw new Error("Say why the changes you turn down are turned down. The supervisor reads it.");

    const { timeZone } = await timecardForEdits(sheet.id);
    const results = new Map<string, Applied>();
    const approve = items.filter((i) => !rejecting.has(i.id));
    const of = (kind: string) => approve.filter((i) => i.kind === kind);

    for (const i of of("CHANGE_PUNCH")) results.set(i.id, await outcome(correctPunch({ originalPunchId: i.punchId!, newPunchTime: i.at!.toISOString(), reason: i.reason })));
    for (const i of of("REMOVE_PUNCH")) results.set(i.id, await outcome(deletePunch({ punchId: i.punchId!, reason: i.reason })));
    // A day's added punches go in together (a clock in is never recalculated
    // without its clock out), each Save's with its own reason.
    const adds = of("ADD_PUNCH");
    for (const key of new Set(adds.map((i) => `${i.day.toISOString()}|${i.requestId}`))) {
      const group = adds.filter((i) => `${i.day.toISOString()}|${i.requestId}` === key);
      const r = await outcome(addManualPunches({
        timesheetId: sheet.id,
        punches: group.map((i) => ({ punchType: i.punchType as "CLOCK_IN" | "CLOCK_OUT", punchTime: i.at!.toISOString(), reason: i.reason })),
      }));
      for (const i of group) results.set(i.id, r);
    }
    for (const i of of("ADD_PAIR")) {
      results.set(i.id, await outcome(addManualPunchPair({ timesheetId: sheet.id, date: i.day.toISOString().slice(0, 10), inTime: i.at!.toISOString(), outTime: i.endAt!.toISOString(), reason: i.reason })));
    }
    for (const i of of("ADD_HOURS")) {
      results.set(i.id, await outcome(addManualHoursEntry({ timesheetId: sheet.id, date: i.day.toISOString().slice(0, 10), hours: i.minutes! / 60, note: i.reason })));
    }
    for (const i of of("APPROVE_REQUEST")) results.set(i.id, await outcome(approveMissedPunch({ punchId: i.punchId!, exceptionId: i.exceptionId! })));
    for (const i of of("MEAL_WAIVER")) {
      const waived = !!(await db.mealWaiver.findUnique({ where: { timesheetId_segmentDate: { timesheetId: sheet.id, segmentDate: i.day } }, select: { id: true } }));
      // Already as asked (HR waived it meanwhile): nothing to toggle.
      results.set(i.id, waived === i.waive ? { success: true } : await outcome(toggleMealWaiver({ timesheetId: sheet.id, segmentDate: i.day.toISOString().slice(0, 10) })));
    }

    const failed: { id: string; error: string }[] = [];
    for (const i of items) {
      if (rejecting.has(i.id)) {
        await db.timecardEditItem.update({ where: { id: i.id }, data: { status: "REJECTED" } });
        continue;
      }
      const r = results.get(i.id) ?? { success: false, error: "It could not be applied." };
      if (!r.success) failed.push({ id: i.id, error: r.error ?? "It could not be applied." });
      await db.timecardEditItem.update({ where: { id: i.id }, data: r.success ? { status: "APPROVED", error: null } : { status: "FAILED", error: r.error ?? null } });
    }
    for (const r of requests) {
      const turnedDown = r.items.some((i) => rejecting.has(i.id));
      await db.timecardEditRequest.update({
        where: { id: r.id },
        data: { status: "DECIDED", decidedById: ctx.employeeId, decidedAt: new Date(), decisionNote: turnedDown ? (note ?? null) : null },
      });
    }

    // One note a day for each supervisor: what HR approved and turned down of theirs.
    const byDay = new Map<string, { sender: string; ok: string[]; no: string[]; bad: string[] }>();
    for (const i of items) {
      const k = `${i.day.toISOString().slice(0, 10)}|${i.sender}`;
      const e = byDay.get(k) ?? { sender: i.sender, ok: [], no: [], bad: [] };
      const words = describeEditItem(i, timeZone);
      if (rejecting.has(i.id)) e.no.push(words);
      else if (failed.some((f) => f.id === i.id)) e.bad.push(words);
      else e.ok.push(words);
      byDay.set(k, e);
    }
    for (const [k, e] of byDay) {
      const parts = [
        e.ok.length ? `approved ${e.ok.join("; ")}` : null,
        e.no.length ? `turned down ${e.no.join("; ")}` : null,
        e.bad.length ? `approved but could not apply ${e.bad.join("; ")}` : null,
      ].filter(Boolean);
      await noteTimecardChange({ timesheetId: sheet.id, day: k.split("|")[0], actorId: ctx.employeeId, change: `Decided ${e.sender}'s changes: ${parts.join("; ")}`, note: e.no.length ? note : null });
    }
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.employeeId,
      action: "TIMECARD_EDITS_DECIDED",
      entityType: "TIMESHEET",
      entityId: sheet.id,
      changes: { after: { requestIds: requests.map((r) => r.id), approved: approve.length - failed.length, rejected: rejecting.size, failed: failed.length, note: note ?? null } },
    });
    revalidatePath("/payroll/timecards");
    revalidatePath("/approvals");
    return { approved: approve.length - failed.length, rejected: rejecting.size, failed };
  },
);

// ─── The Approvals page (11/11) ──────────────────────────────────────────────

const shortDay = (day: string) => dateFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
const periodLabel = (start: Date, end: Date, timeZone: string) => {
  // A period is stored to the next one's first day; its own last day is the one before.
  const fmt = (d: Date) => dateFormat("en-US", { month: "short", day: "numeric", timeZone }).format(d);
  return `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}`;
};

/**
 * Every timecard with supervisor changes waiting for HR that the caller may
 * see, one per person and pay period however many Saves they came in (John,
 * 11/12): the whole company (or their sites) for HR and payroll, their own
 * team for a supervisor. Oldest waiting first, as a queue is worked.
 */
export const getPendingTimecardEdits = withRBAC(
  MISSED_PUNCH_FIXERS,
  async (ctx) => {
    const scope = await employeeScope(ctx, TIMECARD_EDITORS_COMPANY);
    const requests = await db.timecardEditRequest.findMany({
      where: { status: "PENDING", items: { some: { status: "PENDING" } }, timesheet: { employee: scope } },
      orderBy: { createdAt: "asc" },
      take: 1000,
      include: {
        items: { where: { status: "PENDING" }, select: { day: true } },
        submittedBy: { select: { user: { select: { name: true } }, employeeCode: true } },
        timesheet: {
          select: {
            payPeriodId: true,
            payPeriod: { select: { startDate: true, endDate: true } },
            employee: { select: { id: true, employeeCode: true, timeZone: true, user: { select: { name: true } }, site: { select: { name: true, timezone: true } }, department: { select: { name: true } } } },
          },
        },
      },
    });
    const groups = new Map<string, {
      timesheetId: string; employeeId: string; employeeName: string; employeeCode: string; siteName: string; departmentName: string;
      periodId: string; periodLabel: string; senders: string[]; oldestAt: string; count: number; dayKeys: Set<string>;
    }>();
    for (const r of requests) {
      const e = r.timesheet.employee;
      const g = groups.get(r.timesheetId) ?? {
        timesheetId: r.timesheetId,
        employeeId: e.id,
        employeeName: e.user?.name ?? e.employeeCode,
        employeeCode: e.employeeCode,
        siteName: e.site.name,
        departmentName: e.department.name,
        periodId: r.timesheet.payPeriodId,
        periodLabel: periodLabel(r.timesheet.payPeriod.startDate, r.timesheet.payPeriod.endDate, personTimeZone(e, "UTC")),
        senders: [],
        oldestAt: r.createdAt.toISOString(),
        count: 0,
        dayKeys: new Set<string>(),
      };
      const by = r.submittedBy.user?.name ?? r.submittedBy.employeeCode;
      if (!g.senders.includes(by)) g.senders.push(by);
      g.count += r.items.length;
      for (const i of r.items) g.dayKeys.add(i.day.toISOString().slice(0, 10));
      groups.set(r.timesheetId, g);
    }
    return [...groups.values()].map(({ dayKeys, ...g }) => ({ ...g, days: [...dayKeys].sort().map(shortDay) }));
  },
);

export type PendingTimecardEdit = Extract<Awaited<ReturnType<typeof getPendingTimecardEdits>>, { success: true }>["data"][number];

/**
 * A timecard and every supervisor change waiting on it, as the Approvals page
 * draws them: each day of the period with its punches and hours, as the
 * timecard shows them, the waiting changes where they would go (an added
 * punch, a time changed, a punch removed), each with the reason its
 * supervisor gave.
 */
export const getTimecardEditPreview = withRBAC(
  MISSED_PUNCH_FIXERS,
  async (ctx, input: unknown) => {
    const { timesheetId } = z.object({ timesheetId: z.string().min(1) }).parse(input);
    await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY, { forChange: false });
    const sheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      select: {
        id: true,
        payPeriodId: true,
        payPeriod: { select: { startDate: true, endDate: true } },
        employee: { select: { id: true, employeeCode: true, timeZone: true, user: { select: { name: true } }, site: { select: { name: true, timezone: true } }, department: { select: { name: true } } } },
        punches: { where: { isApproved: true, correctedById: null, punchType: { in: ["CLOCK_IN", "CLOCK_OUT"] } }, select: { id: true, punchType: true, roundedTime: true, hoursOnly: true }, orderBy: { roundedTime: "asc" } },
        segments: {
          where: { segmentType: { in: ["WORK", "LEAVE", "HOLIDAY"] } },
          select: { segmentDate: true, segmentType: true, durationMinutes: true, payBucket: true, payBucketOverride: true, payCode: { select: { label: true } } },
        },
      },
    });
    const tz = personTimeZone(sheet.employee, "UTC");
    const requests = await editRequestsFor(sheet.id, tz);
    // Every waiting change, each with who sent it, when and why.
    const waiting = requests.flatMap((r) => r.items.map((i) => ({ ...i, requestId: r.id, reason: r.reason, sender: r.submittedBy, sentAt: r.createdAt })));
    const clock = (d: Date | string) => dateFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(d));

    // Punches as the timecard would show them with the waiting changes in:
    // a time changed shows its new time, a removal is struck through, an
    // addition is a punch of its own.
    type Shown = { id: string; type: string; time: string; at: number; waiting?: "add" | "change" | "remove"; was?: string; hoursOnly?: boolean };
    const byDay = new Map<string, Shown[]>();
    const put = (day: string, p: Shown) => byDay.set(day, [...(byDay.get(day) ?? []), p]);
    for (const p of sheet.punches) {
      const w = waiting.find((i) => i.punchId === p.id && (i.kind === "CHANGE_PUNCH" || i.kind === "REMOVE_PUNCH"));
      const at = w?.kind === "CHANGE_PUNCH" && w.at ? new Date(w.at) : p.roundedTime;
      put(dayAt(p.roundedTime, tz), {
        id: p.id, type: p.punchType, time: clock(at), at: at.getTime(), hoursOnly: p.hoursOnly,
        ...(w ? { waiting: w.kind === "CHANGE_PUNCH" ? "change" as const : "remove" as const, was: w.kind === "CHANGE_PUNCH" ? clock(p.roundedTime) : undefined } : {}),
      });
    }
    for (const i of waiting) {
      const adds: { type: string; at: string }[] =
        (i.kind === "ADD_PUNCH" || i.kind === "APPROVE_REQUEST") && i.at && i.punchType ? [{ type: i.punchType, at: i.at }]
          : i.kind === "ADD_PAIR" && i.at && i.endAt ? [{ type: "CLOCK_IN", at: i.at }, { type: "CLOCK_OUT", at: i.endAt }]
            : [];
      for (const a of adds) put(dayAt(new Date(a.at), tz), { id: `${i.id}:${a.type}`, type: a.type, time: clock(a.at), at: new Date(a.at).getTime(), waiting: "add" });
    }
    /** A day's punches as the timecard's rows: each clock in with the clock out after it. */
    const pairsOf = (punches: Shown[]) => {
      const pairs: { in: Shown | null; out: Shown | null }[] = [];
      for (const p of punches.sort((a, b) => a.at - b.at)) {
        const open = pairs.at(-1);
        if (p.type === "CLOCK_IN") pairs.push({ in: p, out: null });
        else if (open && open.in && !open.out) open.out = p;
        else pairs.push({ in: null, out: p });
      }
      return pairs;
    };

    // Hours as the timecard sums them: leave and holidays under Regular.
    const hours = new Map<string, { reg: number; ot: number; dt: number; total: number; codes: Set<string> }>();
    for (const sg of sheet.segments) {
      const d = sg.segmentDate.toISOString().slice(0, 10);
      const h = hours.get(d) ?? { reg: 0, ot: 0, dt: 0, total: 0, codes: new Set<string>() };
      const bucket = sg.segmentType === "LEAVE" || sg.segmentType === "HOLIDAY" ? "REG"
        : sg.payBucketOverride && !["REG", "OT", "DT"].includes(sg.payBucketOverride) ? sg.payBucketOverride : sg.payBucket;
      if (bucket === "REG") h.reg += sg.durationMinutes;
      else if (bucket === "OT") h.ot += sg.durationMinutes;
      else if (bucket === "DT") h.dt += sg.durationMinutes;
      h.total += sg.durationMinutes;
      if (sg.payCode?.label) h.codes.add(sg.payCode.label);
      hours.set(d, h);
    }

    // Every day of the period, from its first to its last on the person's clock.
    const first = dayAt(sheet.payPeriod.startDate, tz);
    const last = dayAt(new Date(sheet.payPeriod.endDate.getTime() - 1), tz);
    const days = [];
    for (let d = new Date(first + "T12:00:00Z"); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      const h = hours.get(day);
      days.push({
        day,
        label: shortDay(day),
        pairs: pairsOf(byDay.get(day) ?? []),
        reg: h?.reg ?? 0,
        ot: h?.ot ?? 0,
        dt: h?.dt ?? 0,
        total: h?.total ?? 0,
        codes: [...(h?.codes ?? [])],
        items: waiting.filter((i) => i.day === day).map((i) => ({ id: i.id, text: i.text, reason: i.reason, sender: i.sender, sentAt: i.sentAt })),
      });
    }
    return {
      timesheetId: sheet.id,
      // What HR saw, to be refused if a supervisor changes any of it meanwhile.
      items: waiting.map((i) => ({ id: i.id, updatedAt: i.updatedAt })),
      senders: [...new Set(waiting.map((i) => i.sender))],
      employee: { id: sheet.employee.id, name: sheet.employee.user?.name ?? sheet.employee.employeeCode, code: sheet.employee.employeeCode, site: sheet.employee.site.name, department: sheet.employee.department.name },
      periodId: sheet.payPeriodId,
      periodLabel: periodLabel(sheet.payPeriod.startDate, sheet.payPeriod.endDate, tz),
      days,
    };
  },
);

export type TimecardEditPreview = Extract<Awaited<ReturnType<typeof getTimecardEditPreview>>, { success: true }>["data"];

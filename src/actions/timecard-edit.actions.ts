"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { assertEditable, assertEmployeeInScope, timesheetInScope } from "@/lib/rbac/scope";
import { TIMECARD_EDITORS, TIMECARD_EDITORS_COMPANY } from "@/lib/rbac/permissions";
import { writeAuditLog } from "@/lib/audit/logger";
import { noteTimecardChange } from "@/lib/timecards/change-note";
import { describeEditItem, type EditItemInput } from "@/lib/timecards/supervisor-edit-rules";
import {
  assertSupervisorEditsOn,
  editsNeedApproval,
  resolveEditItem,
  sendEditsForApproval,
  timecardForEdits,
} from "@/lib/timecards/supervisor-edits";
import { approveMissedPunch, correctPunch, deletePunch } from "@/actions/punch.actions";
import { addManualHoursEntry, addManualPunchPair, addManualPunches } from "@/actions/timecard-entry.actions";
import { toggleMealWaiver } from "@/actions/timesheet.actions";

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

const HR_SAVES_DIRECTLY = "HR and payroll save timecard changes directly; only supervisors send them for approval.";

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
    await noteTimecardChange({ timesheetId: sheet.id, day, actorId: ctx.employeeId, change: `Changed what waits for HR: ${before} is now ${after}` });
    revalidatePath("/payroll/timecards");
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
    await noteTimecardChange({ timesheetId: sheet.id, day: item.day.toISOString().slice(0, 10), actorId: ctx.employeeId, change: `Took back a change sent for HR approval: ${change}` });
    revalidatePath("/payroll/timecards");
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
 * HR approves a supervisor's request, all of it or all but the changes in
 * `rejectItemIds`, which are turned down with `note` (the supervisor reads
 * it). Approved changes are applied through the actions HR's own changes use,
 * in an order that keeps them apart: times changed, punches removed, punches
 * added (a day's together), Add time, the employee's requests, then meal
 * waivers. One refused (the timecard changed meanwhile) is marked so, with
 * why, and the others still go in.
 */
export const decideTimecardEdits = withRBAC(
  TIMECARD_EDITORS,
  async (ctx, input: unknown): Promise<{ approved: number; rejected: number; failed: { id: string; error: string }[] }> => {
    const { requestId, rejectItemIds, note } = z.object({
      requestId: z.string().min(1),
      rejectItemIds: z.array(z.string().min(1)).max(60).default([]),
      note: z.string().trim().max(500).optional(),
    }).parse(input);
    if (await editsNeedApproval()) throw new Error("Only HR and payroll approve supervisors' changes.");
    const request = await db.timecardEditRequest.findUnique({
      where: { id: requestId },
      include: {
        items: { where: { status: "PENDING" }, orderBy: { createdAt: "asc" } },
        submittedBy: { select: { user: { select: { name: true } }, employeeCode: true } },
      },
    });
    if (!request || request.status !== "PENDING" || request.items.length === 0) {
      throw new Error("These changes were already decided or taken back. Reload the page to see where they stand.");
    }
    const sheet = await timesheetInScope(ctx, request.timesheetId, TIMECARD_EDITORS_COMPANY);
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't approve changes to your own timecard. Ask another admin to do it.");
    assertEditable(sheet.status);
    const rejecting = new Set(rejectItemIds);
    if (rejecting.size > 0 && !note) throw new Error("Say why the changes you turn down are turned down. The supervisor reads it.");

    const { timeZone } = await timecardForEdits(sheet.id);
    const sender = request.submittedBy.user?.name ?? request.submittedBy.employeeCode;
    const reason = `${request.reason} (sent by ${sender})`;
    const results = new Map<string, Applied>();
    const approve = request.items.filter((i) => !rejecting.has(i.id));
    const of = (kind: string) => approve.filter((i) => i.kind === kind);

    for (const i of of("CHANGE_PUNCH")) results.set(i.id, await outcome(correctPunch({ originalPunchId: i.punchId!, newPunchTime: i.at!.toISOString(), reason })));
    for (const i of of("REMOVE_PUNCH")) results.set(i.id, await outcome(deletePunch({ punchId: i.punchId!, reason })));
    const adds = of("ADD_PUNCH");
    for (const d of new Set(adds.map((i) => i.day.toISOString()))) {
      const group = adds.filter((i) => i.day.toISOString() === d);
      const r = await outcome(addManualPunches({
        timesheetId: sheet.id,
        punches: group.map((i) => ({ punchType: i.punchType as "CLOCK_IN" | "CLOCK_OUT", punchTime: i.at!.toISOString(), reason })),
      }));
      for (const i of group) results.set(i.id, r);
    }
    for (const i of of("ADD_PAIR")) {
      results.set(i.id, await outcome(addManualPunchPair({ timesheetId: sheet.id, date: i.day.toISOString().slice(0, 10), inTime: i.at!.toISOString(), outTime: i.endAt!.toISOString(), reason })));
    }
    for (const i of of("ADD_HOURS")) {
      results.set(i.id, await outcome(addManualHoursEntry({ timesheetId: sheet.id, date: i.day.toISOString().slice(0, 10), hours: i.minutes! / 60, note: reason })));
    }
    for (const i of of("APPROVE_REQUEST")) results.set(i.id, await outcome(approveMissedPunch({ punchId: i.punchId!, exceptionId: i.exceptionId! })));
    for (const i of of("MEAL_WAIVER")) {
      const waived = !!(await db.mealWaiver.findUnique({ where: { timesheetId_segmentDate: { timesheetId: sheet.id, segmentDate: i.day } }, select: { id: true } }));
      // Already as asked (HR waived it meanwhile): nothing to toggle.
      results.set(i.id, waived === i.waive ? { success: true } : await outcome(toggleMealWaiver({ timesheetId: sheet.id, segmentDate: i.day.toISOString().slice(0, 10) })));
    }

    const failed: { id: string; error: string }[] = [];
    for (const i of request.items) {
      if (rejecting.has(i.id)) {
        await db.timecardEditItem.update({ where: { id: i.id }, data: { status: "REJECTED" } });
        continue;
      }
      const r = results.get(i.id) ?? { success: false, error: "It could not be applied." };
      if (!r.success) failed.push({ id: i.id, error: r.error ?? "It could not be applied." });
      await db.timecardEditItem.update({ where: { id: i.id }, data: r.success ? { status: "APPROVED", error: null } : { status: "FAILED", error: r.error ?? null } });
    }
    await db.timecardEditRequest.update({
      where: { id: request.id },
      data: { status: "DECIDED", decidedById: ctx.employeeId, decidedAt: new Date(), decisionNote: note ?? null },
    });

    // One note a day: what HR approved and turned down of the supervisor's.
    const byDay = new Map<string, { ok: string[]; no: string[]; bad: string[] }>();
    for (const i of request.items) {
      const k = i.day.toISOString().slice(0, 10);
      const e = byDay.get(k) ?? { ok: [], no: [], bad: [] };
      const words = describeEditItem(i, timeZone);
      if (rejecting.has(i.id)) e.no.push(words);
      else if (failed.some((f) => f.id === i.id)) e.bad.push(words);
      else e.ok.push(words);
      byDay.set(k, e);
    }
    for (const [d, e] of byDay) {
      const parts = [
        e.ok.length ? `approved ${e.ok.join("; ")}` : null,
        e.no.length ? `turned down ${e.no.join("; ")}` : null,
        e.bad.length ? `approved but could not apply ${e.bad.join("; ")}` : null,
      ].filter(Boolean);
      await noteTimecardChange({ timesheetId: sheet.id, day: d, actorId: ctx.employeeId, change: `HR decided ${sender}'s changes: ${parts.join("; ")}`, note: e.no.length ? note : null });
    }
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.employeeId,
      action: "TIMECARD_EDITS_DECIDED",
      entityType: "TIMESHEET",
      entityId: sheet.id,
      changes: { after: { requestId, approved: approve.length - failed.length, rejected: rejecting.size, failed: failed.length, note: note ?? null } },
    });
    revalidatePath("/payroll/timecards");
    return { approved: approve.length - failed.length, rejected: request.items.filter((i) => rejecting.has(i.id)).length, failed };
  },
);

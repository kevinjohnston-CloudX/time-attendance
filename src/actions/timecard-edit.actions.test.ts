import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const order: string[] = [];
  const ok = (name: string) => vi.fn(async () => { order.push(name); return { success: true, data: undefined }; });
  return {
    order,
    correctPunch: ok("change"),
    deletePunch: vi.fn(async () => { h.order.push("remove"); return { success: false, error: "Punch has already been corrected or deleted." }; }),
    approveMissedPunch: ok("request"),
    addManualPunches: ok("add"),
    addManualPunchPair: ok("pair"),
    addManualHoursEntry: ok("hours"),
    toggleMealWaiver: ok("waiver"),
    itemUpdates: [] as { id: string; status: string; error?: string | null }[],
    requestUpdate: vi.fn(async () => ({})),
    request: null as unknown,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rbac/guard", () => ({
  withRBAC: (_p: unknown, handler: (ctx: unknown, input: unknown) => Promise<unknown>) => async (input: unknown) => {
    try {
      return { success: true, data: await handler({ tenantId: "t1", employeeId: "hr1" }, input) };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "ERR" };
    }
  },
}));
vi.mock("@/lib/rbac/scope", () => ({
  assertEditable: vi.fn(),
  assertEmployeeInScope: vi.fn(),
  timesheetInScope: vi.fn(async () => ({ id: "ts1", employeeId: "e1", status: "OPEN" })),
}));
vi.mock("@/lib/audit/logger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/timecards/change-note", () => ({ noteTimecardChange: vi.fn() }));
vi.mock("@/lib/timecards/supervisor-edits", () => ({
  editsNeedApproval: vi.fn(async () => false),
  timecardForEdits: vi.fn(async () => ({ timeZone: "America/New_York" })),
  assertSupervisorEditsOn: vi.fn(),
  resolveEditItem: vi.fn(),
  sendEditsForApproval: vi.fn(),
}));
vi.mock("@/actions/punch.actions", () => ({ correctPunch: h.correctPunch, deletePunch: h.deletePunch, approveMissedPunch: h.approveMissedPunch }));
vi.mock("@/actions/timecard-entry.actions", () => ({ addManualPunches: h.addManualPunches, addManualPunchPair: h.addManualPunchPair, addManualHoursEntry: h.addManualHoursEntry }));
vi.mock("@/actions/timesheet.actions", () => ({ toggleMealWaiver: h.toggleMealWaiver }));
vi.mock("@/lib/db", () => ({
  db: {
    timecardEditRequest: { findUnique: vi.fn(async () => h.request), update: h.requestUpdate },
    timecardEditItem: { update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string; error?: string | null } }) => { h.itemUpdates.push({ id: where.id, ...data }); return {}; }) },
    mealWaiver: { findUnique: vi.fn(async () => null) },
  },
}));

import { decideTimecardEdits } from "./timecard-edit.actions";

const d = (iso: string) => new Date(iso);
const item = (id: string, kind: string, extra: object) => ({ id, kind, status: "PENDING", punchId: null, exceptionId: null, punchType: null, at: null, endAt: null, before: null, minutes: null, waive: null, day: d("2026-11-10T00:00:00Z"), ...extra });

describe("HR deciding a supervisor's changes (11/11)", () => {
  beforeEach(() => {
    h.order.length = 0;
    h.itemUpdates.length = 0;
    h.requestUpdate.mockClear();
    h.request = {
      id: "r1",
      status: "PENDING",
      timesheetId: "ts1",
      reason: "Missed the lunch clock out",
      submittedBy: { user: { name: "Flavio Morales" }, employeeCode: "606069" },
      items: [
        item("add", "ADD_PUNCH", { punchType: "CLOCK_OUT", at: d("2026-11-10T22:16:00Z") }),
        item("chg", "CHANGE_PUNCH", { punchId: "p1", punchType: "CLOCK_OUT", at: d("2026-11-10T19:11:00Z"), before: d("2026-11-10T20:11:00Z") }),
        item("rm", "REMOVE_PUNCH", { punchId: "p2", punchType: "CLOCK_IN", before: d("2026-11-10T22:16:00Z") }),
        item("meal", "MEAL_WAIVER", { waive: true }),
        item("hrs", "ADD_HOURS", { minutes: 480, day: d("2026-11-09T00:00:00Z") }),
      ],
    };
  });

  it("applies what it approves in order, marks what failed, and turns down the rest with the note", async () => {
    const r = await decideTimecardEdits({ requestId: "r1", rejectItemIds: ["hrs"], note: "Those hours are PTO" });
    expect(r.success).toBe(true);
    // Times changed, then removed, then added, then meal waivers; the rejected hours never.
    expect(h.order).toEqual(["change", "remove", "add", "waiver"]);
    expect(h.correctPunch).toHaveBeenCalledWith({ originalPunchId: "p1", newPunchTime: "2026-11-10T19:11:00.000Z", reason: "Missed the lunch clock out (sent by Flavio Morales)" });
    expect(h.addManualPunches).toHaveBeenCalledWith({ timesheetId: "ts1", punches: [{ punchType: "CLOCK_OUT", punchTime: "2026-11-10T22:16:00.000Z", reason: "Missed the lunch clock out (sent by Flavio Morales)" }] });
    expect(h.addManualHoursEntry).not.toHaveBeenCalled();
    const status = Object.fromEntries(h.itemUpdates.map((u) => [u.id, u.status]));
    expect(status).toEqual({ add: "APPROVED", chg: "APPROVED", rm: "FAILED", meal: "APPROVED", hrs: "REJECTED" });
    expect(h.itemUpdates.find((u) => u.id === "rm")?.error).toMatch(/already been corrected/);
    expect(h.requestUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1" }, data: expect.objectContaining({ status: "DECIDED", decidedById: "hr1", decisionNote: "Those hours are PTO" }) }));
    expect(r.success && r.data).toEqual({ approved: 3, rejected: 1, failed: [{ id: "rm", error: "Punch has already been corrected or deleted." }] });
  });

  it("turns nothing down without saying why", async () => {
    const r = await decideTimecardEdits({ requestId: "r1", rejectItemIds: ["hrs"] });
    expect(r.success).toBe(false);
    expect(!r.success && r.error).toMatch(/Say why/);
    expect(h.order).toEqual([]);
  });
});

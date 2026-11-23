import { beforeEach, describe, expect, it, vi } from "vitest";

// Ticket 79641 (11/23): a supervisor could not close the open Absent flags of
// people who had left, as resolving went through the same "no changes to a
// former employee's timecard" check as adding punches. Resolving with a note
// only closes the flag, so it is let through; punches stay refused.
const h = vi.hoisted(() => ({
  active: false,
  updates: [] as unknown[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rbac/guard", () => ({
  withRBAC: (_p: unknown, handler: (ctx: unknown, input: unknown) => Promise<unknown>) => async (input: unknown) => {
    try {
      return { success: true, data: await handler({ tenantId: "t1", employeeId: "sup1", role: "SUPERVISOR" }, input) };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "ERR" };
    }
  },
}));
// The real scope check, with the caller reaching everyone and ranked above them.
vi.mock("@/lib/rbac/check-permission", () => ({ checkPermission: async () => true }));
vi.mock("@/lib/rbac/identity", () => ({ employeeRank: async (id: string) => (id === "sup1" ? 9 : 1) }));
vi.mock("@/lib/get-subordinate-ids", () => ({ getSubordinateIds: async () => ["e1"] }));
vi.mock("@/lib/audit/logger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/timecards/supervisor-edits", () => ({
  editsNeedApproval: vi.fn(async () => false),
  timecardForEdits: vi.fn(),
  assertSupervisorEditsOn: vi.fn(),
  resolveEditItem: vi.fn(),
  sendEditsForApproval: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    hrSiteAccess: { findMany: async () => [] },
    exception: {
      findUniqueOrThrow: async () => ({ id: "x1", timesheetId: "ts1", exceptionType: "ABSENT" }),
      update: async (args: unknown) => { h.updates.push(args); return { id: "x1" }; },
    },
    timesheet: {
      findFirst: async () => ({ id: "ts1", employeeId: "e1", status: "OPEN", employee: { isActive: h.active } }),
      findUniqueOrThrow: async () => { throw new Error("reached the timecard"); },
    },
    $transaction: async () => { throw new Error("wrote punches"); },
  },
}));

import { addMissingPunchForEmployee, resolveException } from "./supervisor.actions";
import { INACTIVE_TIMECARD_ERROR } from "@/lib/inactive-timecards";

describe("exceptions of someone who no longer works here", () => {
  beforeEach(() => { h.active = false; h.updates.length = 0; });

  it("can be resolved with a note, which closes the flag and nothing else", async () => {
    const r = await resolveException({ exceptionId: "x1", resolution: "Left the company on 10/21" });
    expect(r).toEqual({ success: true, data: { id: "x1" } });
    expect(h.updates).toEqual([{
      where: { id: "x1" },
      data: { resolvedAt: expect.any(Date), resolvedById: "sup1", resolution: "Left the company on 10/21" },
    }]);
  });

  it("still refuses adding a punch to their timecard", async () => {
    const r = await addMissingPunchForEmployee({
      timesheetId: "ts1", exceptionId: "x1", punchType: "CLOCK_IN", punchTime: "2026-10-22T12:00:00.000Z", reason: "Forgot to punch",
    });
    expect(r).toEqual({ success: false, error: INACTIVE_TIMECARD_ERROR });
  });
});

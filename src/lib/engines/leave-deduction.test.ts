import { describe, expect, it, vi } from "vitest";

// Two open timecards for one employee: last period's has a PTO day entered as
// punches, which owns a posted leave request; this period's has none.
const punches = [
  { id: "p-in", timesheetId: "ts-last", punchType: "CLOCK_IN", roundedTime: new Date("2026-09-14T13:00:00Z"), payCodeId: "pto", approvedById: null, isApproved: true, correctedById: null },
];
const requests = [
  { id: "r1", employeeId: "e1", sourcePunchId: "p-in", status: "POSTED", leaveTypeId: "lt", durationMinutes: 480, startDate: new Date("2026-09-14T00:00:00Z") },
];
const updates: unknown[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    punch: {
      findMany: async ({ where }: { where: { timesheetId: string } }) => punches.filter((p) => p.timesheetId === where.timesheetId),
      findFirst: async () => null,
    },
    leaveRequest: {
      findMany: async ({ where }: { where: { employeeId: string; sourcePunch?: { timesheetId: string } } }) =>
        requests.filter((r) => r.employeeId === where.employeeId && r.status !== "CANCELLED" &&
          (!where.sourcePunch || punches.find((p) => p.id === r.sourcePunchId)?.timesheetId === where.sourcePunch.timesheetId)),
      update: async (args: unknown) => { updates.push(args); },
    },
    leaveAccrualLedger: { findFirst: async () => null },
    leaveBalance: { findFirst: async () => null },
    payCode: { findUnique: async () => ({ payBucket: "PTO" }) },
    leaveType: { findFirst: async () => ({ id: "lt", category: "PTO" }) },
    workSegment: { findMany: async () => [{ id: "s1", durationMinutes: 480, segmentDate: new Date("2026-09-14T00:00:00Z") }], updateMany: async () => {} },
  },
}));
import { reconcileLeaveDeductions } from "./leave-deduction";

describe("leave entered as punches, when a timecard is recalculated", () => {
  it("leaves the leave of another open timecard alone", async () => {
    updates.length = 0;
    await reconcileLeaveDeductions("ts-this", "e1", "t1");
    expect(updates).toEqual([]);
  });

  it("keeps the leave its own punches hold", async () => {
    updates.length = 0;
    await reconcileLeaveDeductions("ts-last", "e1", "t1");
    expect(updates).toEqual([]);
  });
});

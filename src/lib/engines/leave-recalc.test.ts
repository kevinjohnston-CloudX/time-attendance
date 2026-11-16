import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rebuildSegments: vi.fn(async () => {}),
  syncLeaveSegments: vi.fn(async () => ["open", "locked", "open"]),
  sheets: {
    open: { id: "open", status: "OPEN", employee: { ruleSet: { id: "rs" } } },
    locked: { id: "locked", status: "LOCKED", employee: { ruleSet: { id: "rs" } } },
  } as Record<string, unknown>,
}));
vi.mock("@/lib/db", () => ({ db: { timesheet: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => h.sheets[where.id] ?? null) } } }));
vi.mock("@/lib/engines/segment-builder", () => ({ rebuildSegments: h.rebuildSegments }));
vi.mock("@/lib/engines/leave-segment-builder", () => ({ syncLeaveSegments: h.syncLeaveSegments }));

import { placeLeave } from "./leave-recalc";

// 11/12, Flavio Morales: HR approved 9 h of PTO on a salaried day and the
// timecard showed 8 h Salary and 9 h PTO, 17 h, until Recalculate hours.
describe("leave on a timecard", () => {
  it("works the hours out again on each timecard it went on or came off, once, and not a locked one", async () => {
    await placeLeave("lr1");
    expect(h.syncLeaveSegments).toHaveBeenCalledWith("lr1");
    expect(h.rebuildSegments).toHaveBeenCalledTimes(1);
    expect(h.rebuildSegments).toHaveBeenCalledWith("open", { id: "rs" });
  });
});

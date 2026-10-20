import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  timesheet: { findUnique: vi.fn(), upsert: vi.fn(), findFirst: vi.fn() },
  employee: { findUnique: vi.fn(), findFirst: vi.fn() },
  punch: { findFirst: vi.fn() },
  // No site access set: the caller reaches every site.
  hrSiteAccess: { findMany: vi.fn(async () => []) },
}));
vi.mock("@/lib/db", () => ({ db }));
// Company-wide reach and rank are not what is tested here.
vi.mock("@/lib/rbac/check-permission", () => ({ checkPermission: vi.fn(async () => true) }));
vi.mock("@/lib/rbac/identity", () => ({ employeeRank: vi.fn(async () => 0) }));

import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { INACTIVE_TIMECARD_ERROR } from "@/lib/inactive-timecards";
import { punchInScope, timesheetInScope } from "@/lib/rbac/scope";

const ctx = { employeeId: "hr", tenantId: "t", role: "HR_ADMIN" };

beforeEach(() => vi.clearAllMocks());

describe("An inactive employee's timecards", () => {
  it("are never created", async () => {
    db.timesheet.findUnique.mockResolvedValue(null);
    db.employee.findUnique.mockResolvedValue({ isActive: false });
    await expect(findOrCreateTimesheet("gone", "p")).rejects.toThrow(INACTIVE_TIMECARD_ERROR);
    expect(db.timesheet.upsert).not.toHaveBeenCalled();
  });
  it("are still found when they exist", async () => {
    db.timesheet.findUnique.mockResolvedValue({ id: "ts" });
    await expect(findOrCreateTimesheet("gone", "p")).resolves.toEqual({ id: "ts" });
    expect(db.timesheet.upsert).not.toHaveBeenCalled();
  });
  it("are made for an active employee as before", async () => {
    db.timesheet.findUnique.mockResolvedValue(null);
    db.employee.findUnique.mockResolvedValue({ isActive: true });
    db.timesheet.upsert.mockResolvedValue({ id: "new" });
    await expect(findOrCreateTimesheet("here", "p")).resolves.toEqual({ id: "new" });
  });
  it("refuse a change through the timecard lookup", async () => {
    db.timesheet.findFirst.mockResolvedValue({ id: "ts", employeeId: "gone", status: "OPEN", employee: { isActive: false } });
    await expect(timesheetInScope(ctx, "ts", "TIMECARD_EDIT_ANY")).rejects.toThrow(INACTIVE_TIMECARD_ERROR);
  });
  it("can still be looked at", async () => {
    db.timesheet.findFirst.mockResolvedValue({ id: "ts", employeeId: "gone", status: "OPEN", employee: { isActive: false } });
    await expect(timesheetInScope(ctx, "ts", "TIMECARD_VIEW_ANY", { forChange: false })).resolves.toEqual({ id: "ts", employeeId: "gone", status: "OPEN" });
  });
  it("can still be locked or unlocked by payroll", async () => {
    db.timesheet.findFirst.mockResolvedValue({ id: "ts", employeeId: "gone", status: "OPEN", employee: { isActive: false } });
    await expect(timesheetInScope(ctx, "ts", "PAYROLL_RUN", { allowInactive: true })).resolves.toMatchObject({ id: "ts" });
  });
  it("refuse a change to one of their punches", async () => {
    db.punch.findFirst.mockResolvedValue({ id: "p1", employeeId: "gone", timesheetId: "ts", employee: { isActive: false } });
    await expect(punchInScope(ctx, "p1", "PUNCH_EDIT_ANY")).rejects.toThrow(INACTIVE_TIMECARD_ERROR);
  });
});

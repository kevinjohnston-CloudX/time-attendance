import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    reportDefinition: { findFirstOrThrow: vi.fn() },
    reportSchedule: { create: vi.fn(), update: vi.fn(), findFirstOrThrow: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/audit/logger", () => ({ writeAuditLog: vi.fn() }));
// The permission check itself is tested with the guard; here it lets the call through.
vi.mock("@/lib/rbac/guard", () => ({
  withRBAC: (_permission: string, handler: (ctx: unknown, input: unknown) => Promise<unknown>) => async (input: unknown) => {
    try {
      return { success: true, data: await handler({ tenantId: "t1" }, input) };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "ERR" };
    }
  },
}));

import { createSchedule, updateSchedule, toggleSchedule } from "./report.actions";

const valid = { reportId: "r1", cronExpr: "0 20 L * *", timezone: "America/New_York", format: "CSV", recipients: ["hr@example.com"] };

beforeEach(() => {
  vi.clearAllMocks();
  db.reportDefinition.findFirstOrThrow.mockResolvedValue({ id: "r1" });
  db.reportSchedule.findFirstOrThrow.mockResolvedValue({ id: "s1", cronExpr: "0 8 * * *", timezone: "America/Chicago" });
  db.reportSchedule.create.mockImplementation(async ({ data }) => ({ id: "s1", ...data }));
  db.reportSchedule.update.mockImplementation(async ({ data }) => ({ id: "s1", ...data }));
});

describe("createSchedule", () => {
  it("saves the next send at a real future moment in the schedule's zone", async () => {
    const res = await createSchedule(valid);
    expect(res.success).toBe(true);
    const at = db.reportSchedule.create.mock.calls[0][0].data.nextRunAt as Date;
    expect(at.getTime()).toBeGreaterThan(Date.now());
    // 8 PM Eastern on the last day of a month is 00:00 UTC (EDT) or 01:00 UTC (EST) the next day.
    expect([0, 1]).toContain(at.getUTCHours());
    expect(at.getUTCDate()).toBe(1);
  });

  it("refuses an expression it cannot read, with nothing saved", async () => {
    for (const cronExpr of ["0 8 32 * *", "nonsense", "0 8 * * 9"]) {
      const res = await createSchedule({ ...valid, cronExpr });
      expect(res.success).toBe(false);
    }
    expect(db.reportSchedule.create).not.toHaveBeenCalled();
  });

  it("refuses a day that never comes round", async () => {
    const res = await createSchedule({ ...valid, cronExpr: "0 8 31 2 *" });
    expect(res.success).toBe(false);
    expect(db.reportSchedule.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown time zone, a bad address and a long list", async () => {
    expect((await createSchedule({ ...valid, timezone: "Mars/Base" })).success).toBe(false);
    expect((await createSchedule({ ...valid, recipients: ["not an email"] })).success).toBe(false);
    expect((await createSchedule({ ...valid, recipients: [] })).success).toBe(false);
    expect((await createSchedule({ ...valid, recipients: Array.from({ length: 21 }, (_, i) => `a${i}@b.com`) })).success).toBe(false);
    expect(db.reportSchedule.create).not.toHaveBeenCalled();
  });

  it("saves nothing for a report the caller may not change", async () => {
    db.reportDefinition.findFirstOrThrow.mockRejectedValue(new Error("No ReportDefinition found"));
    const res = await createSchedule(valid);
    expect(res.success).toBe(false);
    expect(db.reportSchedule.create).not.toHaveBeenCalled();
    // The check is scoped to the company and to owner or editor, not just the id.
    expect(db.reportDefinition.findFirstOrThrow.mock.calls[0][0].where).toMatchObject({ id: "r1", tenantId: "t1" });
  });
});

describe("updateSchedule", () => {
  it("recomputes the next send from the new settings", async () => {
    await updateSchedule({ id: "s1", data: { ...valid, cronExpr: "0 7 1 * *" } });
    const at = db.reportSchedule.update.mock.calls[0][0].data.nextRunAt as Date;
    expect(at.getUTCDate()).toBe(1);
    expect(db.reportSchedule.findFirstOrThrow.mock.calls[0][0].where.report).toMatchObject({ tenantId: "t1" });
  });
});

describe("toggleSchedule", () => {
  it("works out a fresh next send when turned back on, so a long pause sends no backlog", async () => {
    await toggleSchedule({ id: "s1", isActive: true });
    const data = db.reportSchedule.update.mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
    expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("leaves the time alone when paused", async () => {
    await toggleSchedule({ id: "s1", isActive: false });
    expect(db.reportSchedule.update.mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it("changes nothing for a schedule the caller may not edit", async () => {
    db.reportSchedule.findFirstOrThrow.mockRejectedValue(new Error("No ReportSchedule found"));
    const res = await toggleSchedule({ id: "other", isActive: true });
    expect(res.success).toBe(false);
    expect(db.reportSchedule.update).not.toHaveBeenCalled();
  });
});

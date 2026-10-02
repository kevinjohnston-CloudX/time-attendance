import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { db, execute, sendReportEmail, isEmailConfigured } = vi.hoisted(() => ({
  db: {
    reportSchedule: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    reportRun: { create: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
  execute: vi.fn(),
  sendReportEmail: vi.fn(),
  isEmailConfigured: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/reports/data-sources", () => ({
  getDataSource: () => ({ execute, brand: "CloudTime" }),
}));
vi.mock("@/lib/reports/email/send-report", () => ({ sendReportEmail, isEmailConfigured }));

import { GET } from "./route";

const call = (auth: string | null = "Bearer s3cret") =>
  GET(new NextRequest("http://x/api/cron/run-scheduled-reports", { headers: auth ? { authorization: auth } : {} }));

const result = { columns: [{ id: "a", label: "A", type: "string" }], rows: [{ a: "1" }], totalRows: 1, period: { start: "2026-10-01", end: "2026-10-01", label: "Oct 1, 2026" } };

function due(over: Record<string, unknown> = {}) {
  return {
    id: "s1",
    reportId: "r1",
    cronExpr: "0 8 * * *",
    timezone: "America/New_York",
    format: "CSV",
    recipients: ["hr@example.com"],
    isActive: true,
    nextRunAt: new Date("2026-10-02T12:00:00Z"),
    report: { id: "r1", name: "Time clock report", tenantId: "t1", dataSource: "TIME_CLOCK_SCAN", config: { columns: ["a"], dateRange: { type: "yesterday" } } },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  isEmailConfigured.mockReturnValue(true);
  db.reportSchedule.updateMany.mockResolvedValue({ count: 1 });
  db.reportSchedule.update.mockResolvedValue({});
  db.reportRun.create.mockResolvedValue({ id: "run1" });
  db.reportRun.update.mockResolvedValue({});
  db.reportRun.count.mockResolvedValue(1);
  execute.mockResolvedValue(result);
  sendReportEmail.mockResolvedValue(undefined);
});

describe("run-scheduled-reports", () => {
  it("refuses a call without the secret, or with a wrong one, and does nothing", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("Bearer s3cret-and-more")).status).toBe(401);
    expect(db.reportSchedule.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when no secret is set", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("sends a due report, names the file and the period, and advances the schedule first", async () => {
    db.reportSchedule.findMany.mockResolvedValue([due()]);
    const res = await (await call()).json();
    expect(res).toEqual({ processed: 1, errors: 0, skipped: 0, total: 1 });

    // Claimed before it ran, moved to a future time, and only if it was still the same send.
    const claim = db.reportSchedule.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: "s1", isActive: true, nextRunAt: new Date("2026-10-02T12:00:00Z") });
    expect(claim.data.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    // The schedule's zone and the moment are what the report reads "yesterday" in.
    expect(execute.mock.calls[0][2]).toMatchObject({ timezone: "America/New_York" });
    expect(sendReportEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ["hr@example.com"],
        fileStem: "CloudTime-Time-clock-report-2026-10-01",
        periodLabel: "Oct 1, 2026",
        brand: "CloudTime",
        rowCount: 1,
      })
    );
    expect(db.reportRun.update).toHaveBeenCalledWith({ where: { id: "run1" }, data: expect.objectContaining({ status: "COMPLETED", rowCount: 1 }) });
  });

  it("skips a schedule another call already claimed, and sends nothing", async () => {
    db.reportSchedule.findMany.mockResolvedValue([due()]);
    db.reportSchedule.updateMany.mockResolvedValue({ count: 0 });
    const res = await (await call()).json();
    expect(res).toMatchObject({ processed: 0, skipped: 1 });
    expect(execute).not.toHaveBeenCalled();
    expect(sendReportEmail).not.toHaveBeenCalled();
  });

  it("records a missing email setup as a failed run, not a finished one", async () => {
    isEmailConfigured.mockReturnValue(false);
    db.reportSchedule.findMany.mockResolvedValue([due()]);
    const res = await (await call()).json();
    expect(res).toMatchObject({ processed: 0, errors: 1 });
    expect(db.reportRun.update).toHaveBeenCalledWith({
      where: { id: "run1" },
      data: expect.objectContaining({ status: "FAILED", error: expect.stringMatching(/not set up/) }),
    });
    expect(sendReportEmail).not.toHaveBeenCalled();
  });

  it("tries a failed send again in half an hour", async () => {
    execute.mockRejectedValue(new Error("boom"));
    db.reportSchedule.findMany.mockResolvedValue([due()]);
    await call();
    const retry = db.reportSchedule.updateMany.mock.calls[1][0];
    const minutes = (retry.data.nextRunAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThan(31);
  });

  it("stops retrying after three failures in a day", async () => {
    execute.mockRejectedValue(new Error("boom"));
    db.reportRun.count.mockResolvedValue(3);
    db.reportSchedule.findMany.mockResolvedValue([due()]);
    await call();
    expect(db.reportSchedule.updateMany).toHaveBeenCalledTimes(1); // only the claim
  });

  it("does not send to an empty or garbled recipient list", async () => {
    db.reportSchedule.findMany.mockResolvedValue([due({ recipients: ["", 5, null] })]);
    const res = await (await call()).json();
    expect(res.errors).toBe(1);
    expect(sendReportEmail).not.toHaveBeenCalled();
  });

  it("switches off a schedule that can never run again instead of looping on it", async () => {
    db.reportSchedule.findMany.mockResolvedValue([due({ cronExpr: "0 8 31 2 *" })]);
    await call();
    expect(db.reportSchedule.updateMany.mock.calls[0][0].data).toEqual({ nextRunAt: null, isActive: false });
  });

  it("only looks for active schedules that are due, oldest first, in small batches", async () => {
    db.reportSchedule.findMany.mockResolvedValue([]);
    await call();
    const q = db.reportSchedule.findMany.mock.calls[0][0];
    expect(q.where).toMatchObject({ isActive: true });
    expect(q.orderBy).toEqual({ nextRunAt: "asc" });
    expect(q.take).toBe(10);
  });
});

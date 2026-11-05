import { beforeEach, describe, expect, it, vi } from "vitest";

// One NJ Exempt - Autopay period with two US timecards and one Rey 11 timecard.
type Sheet = { id: string; employeeId: string; payPeriodId: string; status: string };
let sheets: Sheet[] = [];
let period = { id: "p1", status: "OPEN", tenantId: "t", startDate: new Date("2026-10-11"), endDate: new Date("2026-10-25") };
const posted: { accruals: string[][]; leave: string[][] } = { accruals: [], leave: [] };

vi.mock("@/lib/db", () => ({
  db: {
    timesheet: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => sheets.filter((s) => where.id.in.includes(s.id) && s.status !== "LOCKED"),
      updateMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const s of sheets) if (where.id.in.includes(s.id)) s.status = "LOCKED";
      },
      count: async () => sheets.filter((s) => s.status !== "LOCKED").length,
    },
    payPeriod: {
      findUniqueOrThrow: async () => ({ ...period }),
      update: async ({ data }: { data: { status: string } }) => { period = { ...period, status: data.status }; },
    },
    leaveRequest: {
      findMany: async ({ where }: { where: { employeeId: { in: string[] } } }) => { posted.leave.push(where.employeeId.in); return []; },
    },
  },
}));
vi.mock("@/lib/audit/logger", () => ({ writeAuditLog: async () => {} }));
vi.mock("@/lib/engines/accrual-engine", () => ({
  postAccruals: async (_p: string, ids?: string[]) => { posted.accruals.push(ids ?? ["EVERYONE"]); },
  postLeaveUsage: async () => {},
}));

import { lockTimecards } from "./lock-period";

const actor = { tenantId: "t", employeeId: "hr" };

beforeEach(() => {
  sheets = [
    { id: "us1", employeeId: "e-us1", payPeriodId: "p1", status: "OPEN" },
    { id: "us2", employeeId: "e-us2", payPeriodId: "p1", status: "OPEN" },
    { id: "rey", employeeId: "e-john", payPeriodId: "p1", status: "OPEN" },
  ];
  period = { ...period, status: "OPEN" };
  posted.accruals = [];
  posted.leave = [];
});

describe("Run Payroll locks only the timecards in its file", () => {
  it("leaves Rey 11 open after the US run, and the period open with it", async () => {
    expect(await lockTimecards(["us1", "us2"], actor)).toBe(0);
    expect(sheets.map((s) => s.status)).toEqual(["LOCKED", "LOCKED", "OPEN"]);
    expect(period.status).toBe("OPEN");
  });

  it("posts accruals and approved leave for the people locked, not the whole company", async () => {
    await lockTimecards(["us1", "us2"], actor);
    expect(posted.accruals).toEqual([["e-us1", "e-us2"]]);
    expect(posted.leave).toEqual([["e-us1", "e-us2"]]);
  });

  it("locks the period once the Rey 11 run locks the last timecard", async () => {
    await lockTimecards(["us1", "us2"], actor);
    expect(await lockTimecards(["rey"], actor)).toBe(1);
    expect(period.status).toBe("LOCKED");
    expect(posted.accruals.at(-1)).toEqual(["e-john"]);
  });
});

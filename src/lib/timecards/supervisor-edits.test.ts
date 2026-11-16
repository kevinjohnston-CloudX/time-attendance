import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  employee: { findUnique: vi.fn() },
  timesheet: { findUniqueOrThrow: vi.fn() },
  punch: { findMany: vi.fn() },
  workSegment: { findMany: vi.fn() },
  timecardEditItem: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/rbac/check-permission", () => ({ checkPermission: vi.fn(async () => false) }));
vi.mock("@/lib/timecards/change-note", async () => ({
  noteTimecardChange: vi.fn(),
  dayAt: (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d),
}));

import { assertSupervisorEditsOn, resolveEditItem, timecardForEdits } from "./supervisor-edits";

describe("who a supervisor may send changes for (11/11)", () => {
  const person = (on: boolean, payType: string) => db.employee.findUnique.mockResolvedValueOnce({ payType, site: { supervisorTimecardEdits: on } });

  it("an hourly person at a site with supervisor edits on", async () => {
    person(true, "HOURLY");
    await expect(assertSupervisorEditsOn("e1")).resolves.toBeUndefined();
  });

  it("nobody at a site with them off", async () => {
    person(false, "HOURLY");
    await expect(assertSupervisorEditsOn("e1")).rejects.toThrow(/at this person's site/);
  });

  it("no salaried person: their days are Salary hours, not regular", async () => {
    person(true, "SALARY");
    await expect(assertSupervisorEditsOn("e1")).rejects.toThrow(/salaried/);
  });
});

describe("a day with hours on another pay code (11/11)", () => {
  it("is that code's day: no punches added to a Salary or PTO day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
    db.timesheet.findUniqueOrThrow.mockResolvedValueOnce({ id: "ts1", status: "OPEN", employeeId: "e1", employee: { timeZone: "America/New_York", site: { timezone: "America/New_York" }, ruleSet: { defaultPayCodeId: "reg" } } });
    db.punch.findMany.mockResolvedValueOnce([]);
    db.workSegment.findMany.mockResolvedValueOnce([
      { segmentDate: new Date("2026-11-09T00:00:00Z"), payCodeId: "salary", payCode: { code: 33 } },
      { segmentDate: new Date("2026-11-10T00:00:00Z"), payCodeId: "reg", payCode: { code: 0 } },
    ]);
    db.timecardEditItem.findMany.mockResolvedValueOnce([]);
    const tc = await timecardForEdits("ts1");
    expect([...tc.codedDays]).toEqual(["2026-11-09"]);
    expect(() => resolveEditItem(tc, { kind: "ADD_PUNCH", punchType: "CLOCK_IN", at: "2026-11-09T12:00:00.000Z" })).toThrow(/regular hours/);
    expect(() => resolveEditItem(tc, { kind: "ADD_HOURS", day: "2026-11-09", minutes: 60 })).toThrow(/regular hours/);
    expect(resolveEditItem(tc, { kind: "ADD_PUNCH", punchType: "CLOCK_IN", at: "2026-11-10T12:00:00.000Z" }).kind).toBe("ADD_PUNCH");
    vi.useRealTimers();
  });
});

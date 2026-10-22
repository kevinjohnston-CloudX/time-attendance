import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = new Set<string>();
// Site access rows: "me" is held to 0299 Rutherford.
vi.mock("@/lib/db", () => ({
  db: { hrSiteAccess: { findMany: async ({ where }: { where: { employeeId: string } }) => (where.employeeId === "me" ? [{ siteId: "rutherford" }] : []) } },
}));
vi.mock("@/lib/get-subordinate-ids", () => ({ getSubordinateIds: async () => [] }));
vi.mock("./check-permission", () => ({ checkPermission: async (p: string) => granted.has(p) }));
// The caller is a Payroll Admin (2); the person whose records they change is a System Admin (4).
vi.mock("./identity", () => ({ employeeRank: async (id: string) => (id === "me" ? 2 : 4) }));

import { assertNotSenior, employeeScope } from "./scope";
import { TIMECARD_EDITORS_COMPANY } from "./permissions";

const ctx = { employeeId: "me", tenantId: "t", role: "PAYROLL_ADMIN" };
const RANKED = "You can't change the records of someone ranked above you";

describe("changing the records of someone ranked above you", () => {
  beforeEach(() => granted.clear());

  it("is allowed on any timecard with Timecard write All", async () => {
    granted.add("TIMECARD_EDIT_ANY");
    await expect(assertNotSenior(ctx, "senior", TIMECARD_EDITORS_COMPANY)).resolves.toBeUndefined();
  });

  it("is allowed for leave with Leave write All or Leave approve All", async () => {
    granted.add("LEAVE_REQUEST_ANY");
    await expect(assertNotSenior(ctx, "senior", "LEAVE_REQUEST_ANY")).resolves.toBeUndefined();
    granted.clear();
    granted.add("LEAVE_APPROVE_ANY");
    await expect(assertNotSenior(ctx, "senior", "LEAVE_APPROVE_ANY")).resolves.toBeUndefined();
  });

  it("is refused on a timecard with team access only", async () => {
    granted.add("TIMECARD_EDIT_TEAM");
    await expect(assertNotSenior(ctx, "senior", TIMECARD_EDITORS_COMPANY)).rejects.toThrow(RANKED);
  });

  it("is refused for anything else, whatever the caller holds (a senior's profile, locking)", async () => {
    granted.add("EMPLOYEE_MANAGE").add("PAYROLL_RUN").add("TIMECARD_EDIT_ANY");
    await expect(assertNotSenior(ctx, "senior", "EMPLOYEE_MANAGE")).rejects.toThrow(RANKED);
    await expect(assertNotSenior(ctx, "senior", "PAYROLL_RUN")).rejects.toThrow(RANKED);
    await expect(assertNotSenior(ctx, "senior")).rejects.toThrow(RANKED);
  });

  it("does not let Timecard write All reach leave approval", async () => {
    granted.add("TIMECARD_EDIT_ANY");
    await expect(assertNotSenior(ctx, "senior", "LEAVE_APPROVE_ANY")).rejects.toThrow(RANKED);
  });
});

describe("a Payroll Admin held to some sites", () => {
  it("reaches the timecards of people at those sites only", async () => {
    expect(await employeeScope(ctx, TIMECARD_EDITORS_COMPANY)).toEqual({ tenantId: "t", siteId: { in: ["rutherford"] } });
    expect(await employeeScope(ctx, ["TIMECARD_VIEW_ANY", "TIMECARD_EDIT_ANY"])).toEqual({ tenantId: "t", siteId: { in: ["rutherford"] } });
  });

  it("is not held to sites when none are set", async () => {
    expect(await employeeScope({ ...ctx, employeeId: "other" }, TIMECARD_EDITORS_COMPANY)).toEqual({ tenantId: "t" });
  });

  it("keeps the whole company for leave approval, payroll, and the exception screens' punch fixes", async () => {
    expect(await employeeScope(ctx, "LEAVE_APPROVE_ANY")).toEqual({ tenantId: "t" });
    expect(await employeeScope(ctx, "PAYROLL_RUN")).toEqual({ tenantId: "t" });
    expect(await employeeScope(ctx, "PUNCH_EDIT_ANY")).toEqual({ tenantId: "t" });
  });

  it("never holds a System Admin to sites", async () => {
    expect(await employeeScope({ ...ctx, role: "SYSTEM_ADMIN" }, TIMECARD_EDITORS_COMPANY)).toEqual({ tenantId: "t" });
  });
});

describe("an employee record on the Employees screens", () => {
  it("opens for a Payroll Admin at their own sites, and is not found elsewhere", async () => {
    const { db } = (await import("@/lib/db")) as unknown as { db: Record<string, unknown> };
    const seen: unknown[] = [];
    db.employee = { findFirst: async (q: unknown) => { seen.push(q); return (q as { where: { id: string } }).where.id === "here" ? { id: "here" } : null; } };
    const { assertRecordInReach } = await import("./scope");
    await expect(assertRecordInReach(ctx, "here")).resolves.toBeUndefined();
    expect(seen[0]).toEqual({ where: { id: "here", tenantId: "t", siteId: { in: ["rutherford"] } }, select: { id: true } });
    await expect(assertRecordInReach(ctx, "elsewhere")).rejects.toThrow("This employee isn't available to you");
  });

  it("is held to the company only for an admin with no site limit", async () => {
    const { db } = (await import("@/lib/db")) as unknown as { db: Record<string, unknown> };
    const seen: unknown[] = [];
    db.employee = { findFirst: async (q: unknown) => { seen.push(q); return { id: "x" }; } };
    const { assertRecordInReach } = await import("./scope");
    await assertRecordInReach({ ...ctx, employeeId: "other" }, "x");
    expect(seen[0]).toEqual({ where: { id: "x", tenantId: "t" }, select: { id: true } });
  });
});

describe("changing a leave balance", () => {
  async function setup() {
    const { db } = (await import("@/lib/db")) as unknown as { db: Record<string, unknown> };
    db.employee = { findFirst: async () => ({ id: "found" }) };
    db.leaveType = { findFirst: async ({ where }: { where: { id: string } }) => (where.id === "pto" ? { id: "pto" } : null) };
    return import("./scope");
  }

  it("refuses a Payroll Admin's own balance", async () => {
    const { assertBalanceChangeAllowed } = await setup();
    await expect(assertBalanceChangeAllowed(ctx, "me", "pto")).rejects.toThrow("You can't change your own leave balance");
  });

  it("lets an HR or System Admin change their own", async () => {
    const { assertBalanceChangeAllowed } = await setup();
    await expect(assertBalanceChangeAllowed({ ...ctx, role: "HR_ADMIN" }, "me", "pto")).resolves.toBeUndefined();
    await expect(assertBalanceChangeAllowed({ ...ctx, role: "SYSTEM_ADMIN" }, "me", "pto")).resolves.toBeUndefined();
  });

  it("refuses someone ranked above the caller", async () => {
    const { assertBalanceChangeAllowed } = await setup();
    await expect(assertBalanceChangeAllowed(ctx, "senior", "pto")).rejects.toThrow(RANKED);
  });

  it("refuses a leave type of another company", async () => {
    const { assertBalanceChangeAllowed } = await setup();
    await expect(assertBalanceChangeAllowed({ ...ctx, role: "HR_ADMIN" }, "me", "elsewhere")).rejects.toThrow("Leave type not found");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = new Set<string>();
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/get-subordinate-ids", () => ({ getSubordinateIds: async () => [] }));
vi.mock("./check-permission", () => ({ checkPermission: async (p: string) => granted.has(p) }));
// The caller is a Payroll Admin (2); the person whose records they change is a System Admin (4).
vi.mock("./identity", () => ({ employeeRank: async (id: string) => (id === "me" ? 2 : 4) }));

import { assertNotSenior } from "./scope";
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

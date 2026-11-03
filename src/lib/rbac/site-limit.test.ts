import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { hrSiteAccess: { findMany: async ({ where }: { where: { employeeId: string } }) => (where.employeeId === "nl" ? [{ siteId: "nl1" }] : []) } },
}));

import { siteLimit } from "./site-limit";

describe("Site access", () => {
  it("holds Payroll Admin to its sites", async () => {
    expect(await siteLimit({ employeeId: "nl", role: "PAYROLL_ADMIN" })).toEqual(["nl1"]);
  });

  it("holds a custom role made from Payroll Admin to its sites too, though its built-in role is Employee", async () => {
    expect(await siteLimit({ employeeId: "nl", role: "EMPLOYEE" })).toEqual(["nl1"]);
  });

  it("never holds a System Admin, and no rows means every site", async () => {
    expect(await siteLimit({ employeeId: "nl", role: "SYSTEM_ADMIN" })).toBeNull();
    expect(await siteLimit({ employeeId: "someone", role: "PAYROLL_ADMIN" })).toBeNull();
  });
});

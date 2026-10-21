import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { userHasPermission } from "./check-permission";

// A System Admin passes every check while active, so the inactive rule is
// what decides here.
const admin = { id: "u", role: "SYSTEM_ADMIN", customRoleId: null, canViewAs: false };

describe("an inactive employee's permissions on pages and downloads", () => {
  it("keeps their own documents, balances and last timesheet", async () => {
    for (const p of ["DOCUMENT_VIEW_OWN", "ACCRUAL_VIEW_OWN", "TIMESHEET_SUBMIT_OWN"] as const) {
      expect(await userHasPermission({ ...admin, isActive: false }, p)).toBe(true);
    }
  });

  it("loses everything else, whatever their role was", async () => {
    for (const p of ["PAY_PERIOD_MANAGE", "DOCUMENT_VIEW_ANY", "PUNCH_VIEW_TEAM", "EMPLOYEE_MANAGE"] as const) {
      expect(await userHasPermission({ ...admin, isActive: false }, p)).toBe(false);
    }
  });

  it("changes nothing while they are active", async () => {
    expect(await userHasPermission({ ...admin, isActive: true }, "PAY_PERIOD_MANAGE")).toBe(true);
  });
});

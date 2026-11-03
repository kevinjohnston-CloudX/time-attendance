import { describe, expect, it } from "vitest";
import { ROLE_RANK, editsPeers } from "./roles";

describe("changing the record of someone at your own level", () => {
  it("is open to HR Admins and System Admins (John Raefski adding Juan Munoz's work email)", () => {
    expect(editsPeers(ROLE_RANK.HR_ADMIN)).toBe(true);
    expect(editsPeers(ROLE_RANK.SYSTEM_ADMIN)).toBe(true);
  });

  it("still takes someone more senior below them", () => {
    expect([ROLE_RANK.EMPLOYEE, ROLE_RANK.SUPERVISOR, ROLE_RANK.PAYROLL_ADMIN].map(editsPeers)).toEqual([false, false, false]);
  });
});

describe("companyRank", () => {
  it("never lets a company role outrank a System Admin, so never a super admin", async () => {
    const { companyRank, COMPANY_TOP_RANK, ROLE_RANK } = await import("./roles");
    expect(COMPANY_TOP_RANK).toBe(ROLE_RANK.SYSTEM_ADMIN);
    expect(companyRank(100)).toBe(ROLE_RANK.SYSTEM_ADMIN);
    expect(companyRank(5)).toBeLessThan(ROLE_RANK.SUPER_ADMIN);
    expect(companyRank(2)).toBe(2);
    expect(companyRank(-3)).toBe(0);
  });
});

describe("role rank input", () => {
  it("refuses a rank above System Admin", async () => {
    const { createRoleSchema, updateRoleSchema } = await import("@/lib/validators/role.schema");
    expect(createRoleSchema.safeParse({ name: "x", rank: 5, permissions: [] }).success).toBe(false);
    expect(updateRoleSchema.safeParse({ id: "x", rank: 100 }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: "x", rank: 4, permissions: [] }).success).toBe(true);
  });
});

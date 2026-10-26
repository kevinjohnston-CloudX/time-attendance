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

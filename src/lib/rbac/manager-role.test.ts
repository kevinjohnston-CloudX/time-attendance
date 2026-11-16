import { describe, expect, it } from "vitest";
import { isManagerRole, managerAccessOf } from "./manager-role";

describe("the Manager role", () => {
  it("is the system role of that name only", () => {
    expect(isManagerRole({ name: "Manager", isSystem: true })).toBe(true);
    expect(isManagerRole({ name: "Manager", isSystem: false })).toBe(false);
    expect(isManagerRole({ name: "Supervisor", isSystem: true })).toBe(false);
    expect(isManagerRole(null)).toBe(false);
  });

  // HR, 11/16: sites alone, everyone at them; departments alone, those
  // departments everywhere; both, those departments at those sites.
  it("reaches people through the manager's sites and departments, and only while on the role", () => {
    const where = managerAccessOf("m1") as { OR: Record<string, unknown>[] };
    const [sitesOnly, deptsOnly, both] = where.OR;
    expect(sitesOnly).toEqual({
      site: { hrAccess: { some: { employeeId: "m1", employee: { customRole: { is: { isSystem: true, isActive: true, name: "Manager" } }, managerDepartments: { none: {} } } } } },
    });
    expect(deptsOnly).toEqual({
      department: { managerAccess: { some: { employeeId: "m1", employee: { customRole: { is: { isSystem: true, isActive: true, name: "Manager" } }, siteAccess: { none: {} } } } } },
    });
    expect(both).toEqual({
      AND: [
        { site: { hrAccess: { some: { employeeId: "m1", employee: { customRole: { is: { isSystem: true, isActive: true, name: "Manager" } } } } } } },
        { department: { managerAccess: { some: { employeeId: "m1" } } } },
      ],
    });
  });
});

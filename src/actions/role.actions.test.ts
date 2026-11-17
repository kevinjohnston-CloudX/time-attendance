import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, me, held } = vi.hoisted(() => ({
  db: {
    customRole: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    rolePermission: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
  // An HR Admin: rank 3, below System Admin's 4.
  me: { current: { isSuperAdmin: false, rank: 3 } as { isSuperAdmin: boolean; rank: number } },
  // What the HR Admin's own role holds, by permission key.
  held: new Set(["PAY_VIEW", "EMPLOYEE_MANAGE", "TIMECARD_VIEW_TEAM", "ROLE_MANAGE"]),
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit/logger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/rbac/permission-resolver", () => ({ invalidateRoleCache: vi.fn() }));
vi.mock("@/lib/rbac/current", () => ({ currentIdentity: async () => me.current }));
vi.mock("@/lib/rbac/check-permission", () => ({ checkPermission: async (p: string) => held.has(p) }));
vi.mock("@/lib/rbac/guard", () => ({
  withRBAC: (_permission: string, handler: (ctx: unknown, input: unknown) => Promise<unknown>) => async (input: unknown) => {
    try {
      return { success: true, data: await handler({ tenantId: "t1", employeeId: "e1" }, input) };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "ERR" };
    }
  },
}));

import { createRole, updateRole } from "./role.actions";

const pay = { resource: "pay", action: "read", scope: "all" } as const;
const companyExport = { resource: "company", action: "execute", scope: "all" } as const;
const timecards = { resource: "timecard", action: "read", scope: "team" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  me.current = { isSuperAdmin: false, rank: 3 };
  db.customRole.create.mockImplementation(async ({ data }) => ({ id: "r1", ...data }));
  db.customRole.update.mockImplementation(async ({ data }) => ({ id: "r1", name: "Lead", rank: 1, liveAttendanceOnly: false, ...data }));
});

describe("Giving a role permissions", () => {
  it("lets an HR Admin give a junior role what their own role has", async () => {
    const res = await createRole({ name: "Lead", rank: 1, permissions: [timecards, pay] });
    expect(res.success).toBe(true);
  });

  it("refuses a permission the HR Admin's own role lacks, and saves nothing", async () => {
    const res = await createRole({ name: "Lead", rank: 1, permissions: [timecards, companyExport] });
    expect(res).toEqual({ success: false, error: expect.stringContaining("Company Execute (All)") });
    expect(db.customRole.create).not.toHaveBeenCalled();
  });

  it("leaves a permission the role already had, so editing it doesn't force it off", async () => {
    db.customRole.findFirst.mockResolvedValue({ id: "r1", name: "Lead", rank: 1, isSystem: false, liveAttendanceOnly: false, permissions: [companyExport] });
    const res = await updateRole({ id: "r1", permissions: [companyExport, timecards] });
    expect(res.success).toBe(true);
  });

  it("lets a System Admin give anything", async () => {
    me.current = { isSuperAdmin: false, rank: 4 };
    const res = await createRole({ name: "Lead", rank: 1, permissions: [companyExport] });
    expect(res.success).toBe(true);
  });
});

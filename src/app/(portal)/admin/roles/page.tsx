import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getRoles } from "@/actions/role.actions";
import { getPermissions } from "@/lib/rbac/permissions";
import { ROLES, ROLE_RANK } from "@/lib/rbac/roles";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";
import { db } from "@/lib/db";
import { RolesClient } from "@/components/admin/roles-client";

/**
 * Roles &amp; Permissions.
 *
 * <p>Two things are loaded: the tenant's roles, which are what the list shows,
 * and the built-in role definitions, which are only templates — the editor
 * offers them under "load permissions from a built-in role". They are not rows
 * in the table: the seed writes every built-in as a real role with
 * `isSystem: true`, so listing both would show the same six roles twice.
 *
 * <p>The header and its actions are rendered inside {@link RolesClient},
 * because the primary action opens the editor and the editor is client state.
 */

/** What the list needs off a role; the editor fetches the rest when it opens. */
type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
  isActive: boolean;
  _count: { employees: number };
};

const BUILTIN_LABELS: Record<string, string> = {
  EMPLOYEE:      "Employee",
  SUPERVISOR:    "Supervisor",
  PAYROLL_ADMIN: "Payroll Admin",
  HR_ADMIN:      "HR Admin",
  SYSTEM_ADMIN:  "System Admin",
  SUPER_ADMIN:   "Super Admin",
};

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  EMPLOYEE:      "Standard employee — punch, timesheet, and leave access",
  SUPERVISOR:    "Team management — approve timesheets and leave for direct reports",
  PAYROLL_ADMIN: "Payroll processing — manage pay periods and approve all timesheets",
  HR_ADMIN:      "HR management — full employee, site, and approval access",
  SYSTEM_ADMIN:  "Full access to all system features and settings",
  SUPER_ADMIN:   "Unrestricted super-administrator",
};

export default async function RolesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "ROLE_MANAGE")) redirect("/admin");

  const [rolesResult, roleCounts] = await Promise.all([
    getRoles(),
    db.employee.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);

  const countByRole = Object.fromEntries(
    (roleCounts as { role: string; _count: { _all: number } }[]).map((r) => [r.role, r._count._all])
  );

  const builtinRoles = ROLES.map((key) => ({
    key,
    name: BUILTIN_LABELS[key] ?? key,
    description: BUILTIN_DESCRIPTIONS[key] ?? null,
    rank: ROLE_RANK[key],
    permissions: getPermissions(key)
      .map((p) => LEGACY_MAP[p])
      .filter(Boolean) as { resource: string; action: string; scope: string }[],
    employeeCount: countByRole[key] ?? 0,
  }));

  return (
    <RolesClient
      roles={rolesResult.success ? (rolesResult as { success: true; data: RoleRow[] }).data : []}
      builtinRoles={builtinRoles}
    />
  );
}

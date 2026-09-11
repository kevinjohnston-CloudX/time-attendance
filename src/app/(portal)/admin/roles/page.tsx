import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getRoles } from "@/actions/role.actions";
import { getPermissions } from "@/lib/rbac/permissions";
import { ROLES, ROLE_RANK } from "@/lib/rbac/roles";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";
import { db } from "@/lib/db";
import { RolesClient } from "@/components/admin/roles-client";

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
    <div className="max-w-5xl">
      <Link
        href="/admin"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Roles &amp; Permissions</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Manage roles and assign permissions to control access across the system.
      </p>

      <RolesClient
        roles={rolesResult.success ? (rolesResult as { success: true; data: any[] }).data : []}
        builtinRoles={builtinRoles}
      />
    </div>
  );
}

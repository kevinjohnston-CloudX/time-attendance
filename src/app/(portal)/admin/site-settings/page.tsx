import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getSites, getDepartments, getRuleSets, getLeaveTypesAdmin } from "@/actions/admin.actions";
import { getHolidays } from "@/actions/holiday.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { getReasonCodes } from "@/actions/reason-code.actions";
import { getPtoPolicies } from "@/actions/pto-policy.actions";
import { getShifts } from "@/actions/shift.actions";
import { getRoles } from "@/actions/role.actions";
import { getPermissions } from "@/lib/rbac/permissions";
import { ROLES, ROLE_RANK } from "@/lib/rbac/roles";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";
import { db } from "@/lib/db";
import { SiteSettingsClient } from "./site-settings-client";

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

export default async function SiteSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [hasSiteManage, hasRulesManage, hasPayPeriodManage, hasRoleManage] = await Promise.all([
    userHasPermission(session.user, "SITE_MANAGE"),
    userHasPermission(session.user, "RULES_MANAGE"),
    userHasPermission(session.user, "PAY_PERIOD_MANAGE"),
    userHasPermission(session.user, "ROLE_MANAGE"),
  ]);

  if (!hasSiteManage && !hasRulesManage && !hasPayPeriodManage && !hasRoleManage) redirect("/admin");

  const { tab } = (await searchParams) ?? {};

  const [
    sitesResult, deptsResult, ruleSetsResult, holidaysResult,
    leaveTypesResult, payCodesResult, reasonCodesResult, ptoPoliciesResult,
    shiftsResult,
    rolesResult, roleCounts,
  ] = await Promise.all([
    getSites(),
    getDepartments(),
    getRuleSets(),
    getHolidays(),
    getLeaveTypesAdmin(),
    getAllPayCodes(),
    getReasonCodes(),
    getPtoPolicies(),
    hasRulesManage ? getShifts() : Promise.resolve({ success: true as const, data: [] }),
    hasRoleManage ? getRoles() : Promise.resolve({ success: true as const, data: [] }),
    hasRoleManage
      ? db.employee.groupBy({ by: ["role"], _count: { _all: true } })
      : Promise.resolve([]),
  ]);

  const countByRole = Object.fromEntries(
    (roleCounts as { role: string; _count: { _all: number } }[]).map((r) => [r.role, r._count._all])
  );

  const builtinRoles = hasRoleManage
    ? ROLES.map((key) => ({
        key,
        name: BUILTIN_LABELS[key] ?? key,
        description: BUILTIN_DESCRIPTIONS[key] ?? null,
        rank: ROLE_RANK[key],
        permissions: getPermissions(key)
          .map((p) => LEGACY_MAP[p])
          .filter(Boolean) as { resource: string; action: string; scope: string }[],
        employeeCount: countByRole[key] ?? 0,
      }))
    : [];

  return (
    <div>
      <Link
        href="/admin"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Site Settings</h1>

      <SiteSettingsClient
        sites={sitesResult.success ? sitesResult.data : []}
        departments={deptsResult.success ? deptsResult.data : []}
        ruleSets={ruleSetsResult.success ? ruleSetsResult.data : []}
        holidays={holidaysResult.success ? holidaysResult.data : []}
        leaveTypes={leaveTypesResult.success ? leaveTypesResult.data : []}
        payCodes={payCodesResult.success ? payCodesResult.data : []}
        reasonCodes={reasonCodesResult.success ? reasonCodesResult.data : []}
        ptoPolicies={ptoPoliciesResult.success ? ptoPoliciesResult.data : []}
        shifts={shiftsResult.success ? shiftsResult.data : []}
        roles={rolesResult.success ? (rolesResult as { success: true; data: any[] }).data : []}
        builtinRoles={builtinRoles}
        hasSiteManage={hasSiteManage}
        hasRulesManage={hasRulesManage}
        hasPayPeriodManage={hasPayPeriodManage}
        hasRoleManage={hasRoleManage}
        initialTab={tab}
      />
    </div>
  );
}

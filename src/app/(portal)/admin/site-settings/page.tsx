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
import { getHolidayRules } from "@/actions/holiday-rule.actions";
import { getPayCategories } from "@/actions/pay-category.actions";
import { SiteSettingsClient } from "./site-settings-client";

export default async function SiteSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [hasSiteManage, hasRulesManage, hasPayPeriodManage] = await Promise.all([
    userHasPermission(session.user, "SITE_MANAGE"),
    userHasPermission(session.user, "RULES_MANAGE"),
    userHasPermission(session.user, "PAY_PERIOD_MANAGE"),
  ]);

  if (!hasSiteManage && !hasRulesManage && !hasPayPeriodManage) redirect("/admin");

  const { tab } = (await searchParams) ?? {};

  const [
    sitesResult, deptsResult, ruleSetsResult, holidaysResult,
    leaveTypesResult, payCodesResult, reasonCodesResult, ptoPoliciesResult,
    shiftsResult, holidayRulesResult, payCategoriesResult,
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
    hasRulesManage ? getHolidayRules() : Promise.resolve({ success: true as const, data: [] }),
    hasRulesManage ? getPayCategories() : Promise.resolve({ success: true as const, data: [] }),
  ]);

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
        holidayRules={holidayRulesResult.success ? holidayRulesResult.data : []}
        payCategories={payCategoriesResult.success ? payCategoriesResult.data : []}
        hasSiteManage={hasSiteManage}
        hasRulesManage={hasRulesManage}
        hasPayPeriodManage={hasPayPeriodManage}
        initialTab={tab}
      />
    </div>
  );
}

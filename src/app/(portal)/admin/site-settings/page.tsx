import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getSites, getDepartments, getLeaveTypesAdmin } from "@/actions/admin.actions";
import { getHolidays } from "@/actions/holiday.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { getReasonCodes } from "@/actions/reason-code.actions";
import { getPtoPolicies } from "@/actions/pto-policy.actions";
import { getHolidayRules } from "@/actions/holiday-rule.actions";
import { getPayCategories } from "@/actions/pay-category.actions";
import { getPayTypes } from "@/actions/pay-type.actions";
import { getJobTitles } from "@/actions/job-title.actions";
import { getAgencies } from "@/actions/agency.actions";
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
    sitesResult, deptsResult, holidaysResult,
    leaveTypesResult, payCodesResult, reasonCodesResult, ptoPoliciesResult,
    holidayRulesResult, payCategoriesResult, payTypesResult, jobTitlesResult, agenciesResult,
  ] = await Promise.all([
    getSites(),
    getDepartments(),
    getHolidays(),
    getLeaveTypesAdmin(),
    getAllPayCodes(),
    getReasonCodes(),
    hasRulesManage ? getPtoPolicies() : Promise.resolve({ success: true as const, data: [] }),
    hasRulesManage ? getHolidayRules() : Promise.resolve({ success: true as const, data: [] }),
    hasRulesManage ? getPayCategories() : Promise.resolve({ success: true as const, data: [] }),
    hasRulesManage ? getPayTypes() : Promise.resolve({ success: true as const, data: [] }),
    hasRulesManage ? getJobTitles() : Promise.resolve({ success: true as const, data: [] }),
    hasRulesManage ? getAgencies() : Promise.resolve({ success: true as const, data: [] }),
  ]);

  // Serialize Prisma Decimal/Date objects so they cross the server→client boundary as plain values
  function serialize<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }

  return (
    <div>
      <Link
        href="/admin"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Company Setup</h1>

      <SiteSettingsClient
        sites={serialize(sitesResult.success ? sitesResult.data : [])}
        departments={serialize(deptsResult.success ? deptsResult.data : [])}
        holidays={serialize(holidaysResult.success ? holidaysResult.data : [])}
        leaveTypes={serialize(leaveTypesResult.success ? leaveTypesResult.data : [])}
        payCodes={serialize(payCodesResult.success ? payCodesResult.data : [])}
        reasonCodes={serialize(reasonCodesResult.success ? reasonCodesResult.data : [])}
        ptoPolicies={serialize(ptoPoliciesResult.success ? ptoPoliciesResult.data : [])}
        holidayRules={serialize(holidayRulesResult.success ? holidayRulesResult.data : [])}
        payCategories={serialize(payCategoriesResult.success ? payCategoriesResult.data : [])}
        payTypes={serialize(payTypesResult.success ? payTypesResult.data : [])}
        jobTitles={serialize(jobTitlesResult.success ? jobTitlesResult.data : [])}
        agencies={serialize(agenciesResult.success ? agenciesResult.data : [])}
        hasSiteManage={hasSiteManage}
        hasRulesManage={hasRulesManage}
        hasPayPeriodManage={hasPayPeriodManage}
        initialTab={tab}
      />
    </div>
  );
}

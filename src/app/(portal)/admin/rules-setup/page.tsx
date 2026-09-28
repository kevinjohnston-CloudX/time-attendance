import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getRuleSets, getLeaveTypesAdmin } from "@/actions/admin.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { getPtoPolicies } from "@/actions/pto-policy.actions";
import { getShifts } from "@/actions/shift.actions";
import { getHolidayRules } from "@/actions/holiday-rule.actions";
import { RulesSetupClient } from "./rules-setup-client";

export default async function RulesSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const { tab } = (await searchParams) ?? {};

  const [ruleSetsResult, shiftsResult, holidayRulesResult, ptoPoliciesResult, leaveTypesResult, payCodesResult] =
    await Promise.all([
      getRuleSets(),
      getShifts(),
      getHolidayRules(),
      getPtoPolicies(),
      getLeaveTypesAdmin(),
      getAllPayCodes(),
    ]);

  // Serialize Prisma Decimal/Date objects so they cross the server→client boundary as plain values
  function serialize<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }

  return (
    <div>
      <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Rules Setup</h1>
      <RulesSetupClient
        ruleSets={serialize(ruleSetsResult.success ? ruleSetsResult.data : [])}
        shifts={serialize(shiftsResult.success ? shiftsResult.data : [])}
        holidayRules={serialize(holidayRulesResult.success ? holidayRulesResult.data : [])}
        ptoPolicies={serialize(ptoPoliciesResult.success ? ptoPoliciesResult.data : [])}
        leaveTypes={serialize(leaveTypesResult.success ? leaveTypesResult.data : [])}
        payCodes={serialize(payCodesResult.success ? payCodesResult.data : [])}
        initialTab={tab}
      />
    </div>
  );
}

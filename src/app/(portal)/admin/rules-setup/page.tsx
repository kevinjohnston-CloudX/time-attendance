import { redirect } from "next/navigation";
import { SESSION_ENDED_HREF } from "@/lib/auth.config";
import { auth } from "@/lib/auth";
import { manageOrView } from "@/lib/rbac/check-permission";
import { ViewOnly } from "@/components/admin/setup/view-only";
import { getRuleSets } from "@/actions/admin.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { getPtoPolicies } from "@/actions/pto-policy.actions";
import { getShifts } from "@/actions/shift.actions";
import { getHolidayRules } from "@/actions/holiday-rule.actions";
import { RulesSetupClient } from "./rules-setup-client";

/**
 * Rules Setup: the pay rules screen.
 *
 * <p>Everything the four editors need is fetched here in one round, so the
 * area rail below can switch without another server trip. The query string
 * carries where to start: `tab` picks the area, `view` preselects the rule
 * set status filter, and an old `policy` link goes to that policy's page.
 */
export default async function RulesSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; policy?: string; view?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(SESSION_ENDED_HREF);

  // Rule Sets on Read opens every area to look at, with nothing to change.
  const access = await manageOrView(session.user, "RULES_MANAGE", "RULES_VIEW");
  if (!access) redirect("/dashboard");

  const { tab, policy, view } = (await searchParams) ?? {};
  // An old link to one policy opens it on its own page now.
  if (policy) redirect(`/admin/rules-setup/leave-policies/${encodeURIComponent(policy)}`);

  const [
    ruleSetsResult,
    shiftsResult,
    holidayRulesResult,
    ptoPoliciesResult,
    payCodesResult,
  ] = await Promise.all([
    getRuleSets(),
    getShifts(),
    getHolidayRules(),
    getPtoPolicies(),
    getAllPayCodes(),
  ]);

  // Serialize Prisma Decimal/Date objects so they cross the server→client boundary as plain values
  function serialize<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }

  // The header is drawn by the client, which pins it over the areas rail.
  return (
    <ViewOnly on={access === "view"}>
      <RulesSetupClient
        ruleSets={serialize(ruleSetsResult.success ? ruleSetsResult.data : [])}
        shifts={serialize(shiftsResult.success ? shiftsResult.data : [])}
        holidayRules={serialize(
          holidayRulesResult.success ? holidayRulesResult.data : [],
        )}
        ptoPolicies={serialize(
          ptoPoliciesResult.success ? ptoPoliciesResult.data : [],
        )}
        payCodes={serialize(payCodesResult.success ? payCodesResult.data : [])}
        initialTab={tab}
        initialRuleSetView={view}
      />
    </ViewOnly>
  );
}

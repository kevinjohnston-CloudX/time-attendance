import { redirect } from "next/navigation";
import { format } from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { LinkButton, PageHeader } from "@/components/ui";
import { manageOrView, userHasPermission } from "@/lib/rbac/check-permission";
import { getTenantSettings } from "@/actions/pay-period.actions";
import { CompanySettings } from "@/components/admin/company-settings";
import { DataProtectionPanel } from "@/components/admin/data-protection-panel";
import { getDataProtection } from "@/actions/privacy.actions";

/**
 * Company Settings: the pay schedule every rule set without its own falls
 * back to, and Generate for the next company pay period.
 *
 * <p>Both settings decide where pay periods start and end, which is why the
 * page opens with the note on when a change takes effect. The screen itself
 * is CompanySettings; this only gates it and loads the stored values.
 */
export default async function CompanySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/admin");

  const [result, canOpenRules, protection, canReview] = await Promise.all([
    getTenantSettings(),
    manageOrView(session.user, "RULES_MANAGE", "RULES_VIEW").then((access) => access !== null),
    // Only for those who manage employee records; the panel is left out for anyone else.
    userHasPermission(session.user, "EMPLOYEE_MANAGE").then((can) => (can ? getDataProtection() : null)),
    // The retention review downloads people's data, so it needs Export data too.
    userHasPermission(session.user, "EMPLOYEE_DATA_EXPORT"),
  ]);
  if (!result.success) redirect("/admin");
  const { payFrequency, payPeriodAnchorDate, name, nextPeriod, defaultRuleSets } = result.data;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        pinned
        title="Company Settings"
        subtitle={name}
        actions={
          <LinkButton href="/admin" hierarchy="tertiary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
            Administration
          </LinkButton>
        }
      />
      <CompanySettings
        frequency={payFrequency}
        anchor={payPeriodAnchorDate ? format(parseUtcDate(payPeriodAnchorDate), "yyyy-MM-dd") : ""}
        next={
          nextPeriod
            ? { startDate: nextPeriod.startDate.toISOString(), endDate: nextPeriod.endDate.toISOString(), frequency: nextPeriod.frequency }
            : null
        }
        defaultRuleSets={defaultRuleSets}
        canOpenRules={canOpenRules}
      />
      {protection?.success && <DataProtectionPanel initial={protection.data} canReview={canReview} />}
    </div>
  );
}

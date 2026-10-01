import { redirect } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { LinkButton, PageHeader } from "@/components/ui";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTenantSettings } from "@/actions/pay-period.actions";
import { getGateAlertsSetting } from "@/actions/gate-refusals.actions";
import { CompanySettings } from "@/components/admin/company-settings";

/**
 * Company Settings: the pay schedule every rule set without its own falls
 * back to, and Generate for the next company pay period.
 *
 * <p>Both settings decide where pay periods start and end, which is why the
 * page opens with the note on when a change takes effect. The screen itself
 * is CompanySettings; this only gates it and loads the stored values.
 *
 * <p>System Admins also get the Live Attendance gate alert switch here. Its
 * action refuses anybody else, so the panel is left out for them rather than
 * shown and failing.
 */
export default async function CompanySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/admin");

  const [result, canOpenRules, gate] = await Promise.all([
    getTenantSettings(),
    userHasPermission(session.user, "RULES_MANAGE"),
    getGateAlertsSetting(),
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
        anchor={payPeriodAnchorDate ? format(payPeriodAnchorDate, "yyyy-MM-dd") : ""}
        next={
          nextPeriod
            ? { startDate: nextPeriod.startDate.toISOString(), endDate: nextPeriod.endDate.toISOString(), frequency: nextPeriod.frequency }
            : null
        }
        defaultRuleSets={defaultRuleSets}
        canOpenRules={canOpenRules}
        gateAlerts={gate.success ? gate.data : null}
      />
    </div>
  );
}

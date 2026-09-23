import { redirect } from "next/navigation";
import { format, addDays } from "date-fns";
import { auth } from "@/lib/auth";
import { Banner, Button, Card, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { userHasPermission } from "@/lib/rbac/check-permission";
import {
  getTenantSettings,
  updateTenantSettings,
  generateNextPayPeriod,
} from "@/actions/pay-period.actions";
import type { PayFrequency } from "@prisma/client";

/**
 * Company Settings, on the portal design's document template: a callout that
 * says when a change takes effect, then one card per group of fields.
 *
 * <p>Only two settings live here, and between them they decide where every pay
 * period in the product starts and ends. That is why the page carries a banner
 * rather than a bare form — the fields look like preferences and are not.
 */

const FREQ_LABELS: Record<PayFrequency, string> = {
  WEEKLY: "Weekly (every 7 days)",
  BIWEEKLY: "Bi-weekly (every 14 days)",
  SEMIMONTHLY: "Semi-monthly (1st–15th and 16th–end)",
  MONTHLY: "Monthly (1st–end of month)",
};

/**
 * The field grid from the design's document template.
 *
 * <p>`auto-fit` rather than a fixed two columns: this card has two fields and
 * the next one may have four, and a fixed count leaves a hole in the first and
 * squeezes the second.
 */
const FIELD_GRID =
  "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,48%)),1fr))]";

export default async function CompanySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/admin");

  const result = await getTenantSettings();
  if (!result.success) redirect("/admin");
  const { payFrequency, payPeriodAnchorDate, name } = result.data;

  const anchorStr = payPeriodAnchorDate
    ? format(payPeriodAnchorDate, "yyyy-MM-dd")
    : "";

  // Preview next period dates if anchor is set
  let nextPreview: { startDate: Date; endDate: Date } | null = null;
  if (payPeriodAnchorDate) {
    const anchor = payPeriodAnchorDate;
    const today = new Date();
    if (payFrequency === "WEEKLY") {
      const n = Math.floor((today.getTime() - anchor.getTime()) / (7 * 86400000));
      const start = addDays(anchor, (n + 1) * 7);
      nextPreview = { startDate: start, endDate: addDays(start, 6) };
    } else if (payFrequency === "BIWEEKLY") {
      const n = Math.floor((today.getTime() - anchor.getTime()) / (14 * 86400000));
      const start = addDays(anchor, (n + 1) * 14);
      nextPreview = { startDate: start, endDate: addDays(start, 13) };
    } else if (payFrequency === "SEMIMONTHLY") {
      const day = today.getDate();
      if (day <= 15) {
        nextPreview = {
          startDate: new Date(today.getFullYear(), today.getMonth(), 16),
          endDate: new Date(today.getFullYear(), today.getMonth() + 1, 0),
        };
      } else {
        nextPreview = {
          startDate: new Date(today.getFullYear(), today.getMonth() + 1, 1),
          endDate: new Date(today.getFullYear(), today.getMonth() + 1, 15),
        };
      }
    } else {
      nextPreview = {
        startDate: new Date(today.getFullYear(), today.getMonth() + 1, 1),
        endDate: new Date(today.getFullYear(), today.getMonth() + 2, 0),
      };
    }
  }

  async function handleSave(formData: FormData) {
    "use server";
    await updateTenantSettings({
      payFrequency: formData.get("payFrequency") as PayFrequency,
      payPeriodAnchorDate: formData.get("payPeriodAnchorDate") as string,
    });
  }

  async function handleGenerate() {
    "use server";
    const result = await generateNextPayPeriod();
    if (!result.success) throw new Error(result.error);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned
        title="Company Settings"
        subtitle={name}
        actions={
          <LinkButton href="/admin" hierarchy="tertiary">
            ← Administration
          </LinkButton>
        }
      />

      <div className="flex flex-col gap-4" style={{ maxWidth: 1080 }}>
        <Banner
          tone="info"
          body="Saving these does not move pay periods that already exist — it decides how the next ones are generated."
        />

        <Card
          title="Pay Period Configuration"
          subtitle="The frequency and one real start date; every other period is calculated from the pair"
        >
          <form action={handleSave} className="flex flex-col gap-4">
            <div className={FIELD_GRID}>
              <label className="flex w-full flex-col gap-1.5">
                <span className="wms-label">Pay Frequency</span>
                <Select name="payFrequency" defaultValue={payFrequency} style={{ width: "100%" }}>
                  {(Object.keys(FREQ_LABELS) as PayFrequency[]).map((f) => (
                    <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                  ))}
                </Select>
              </label>

              <Input
                label="Anchor Date"
                name="payPeriodAnchorDate"
                type="date"
                defaultValue={anchorStr}
                required
                hint="Any Monday (weekly/bi-weekly) or 1st/16th (semi-monthly) that really was a period start."
              />
            </div>

            <div>
              <Button type="submit" hierarchy="primary">
                Save Settings
              </Button>
            </div>
          </form>
        </Card>

        <Card
          title="Generate Next Pay Period"
          subtitle="Creates the next consecutive period after the most recent one in the system"
          actions={
            <LinkButton href="/payroll/pay-periods" hierarchy="link" size="sm">
              View all pay periods
            </LinkButton>
          }
        >
          <div className="flex flex-col gap-4">
            {nextPreview && (
              <div className="flex flex-col gap-0.5">
                <span className="wms-label">Next period</span>
                <span
                  className="tabular"
                  style={{
                    font: "var(--type-body1)",
                    fontWeight: "var(--weight-medium)",
                    color: "var(--text-primary)",
                  }}
                >
                  {format(nextPreview.startDate, "MMM d, yyyy")} –{" "}
                  {format(nextPreview.endDate, "MMM d, yyyy")}
                </span>
              </div>
            )}

            {!payPeriodAnchorDate && (
              <Banner tone="warning" body="Save an anchor date above before generating." />
            )}

            <form action={handleGenerate}>
              <Button type="submit" hierarchy="primary" disabled={!payPeriodAnchorDate}>
                Generate Pay Period
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}

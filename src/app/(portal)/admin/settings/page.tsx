import { redirect } from "next/navigation";
import Link from "next/link";
import { format, addDays } from "date-fns";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import {
  getTenantSettings,
  updateTenantSettings,
  generateNextPayPeriod,
} from "@/actions/pay-period.actions";
import type { PayFrequency } from "@prisma/client";

const FREQ_LABELS: Record<PayFrequency, string> = {
  WEEKLY: "Weekly (every 7 days)",
  BIWEEKLY: "Bi-weekly (every 14 days)",
  SEMIMONTHLY: "Semi-monthly (1st–15th and 16th–end)",
  MONTHLY: "Monthly (1st–end of month)",
};

export default async function CompanySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "PAY_PERIOD_MANAGE")) redirect("/admin");

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
    <div className="max-w-2xl">
      <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        Company Settings
      </h1>
      <p className="mt-1 text-sm text-zinc-500">{name}</p>

      {/* Pay Period Config */}
      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Pay Period Configuration
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Set the pay frequency and a known anchor date. The anchor can be any
          historical pay period start date — the system uses it to calculate all
          past and future periods automatically.
        </p>

        <form action={handleSave} className="mt-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Pay Frequency
            </label>
            <select
              name="payFrequency"
              defaultValue={payFrequency}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              {(Object.keys(FREQ_LABELS) as PayFrequency[]).map((f) => (
                <option key={f} value={f}>{FREQ_LABELS[f]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Anchor Date{" "}
              <span className="font-normal text-zinc-400">(a known pay period start date)</span>
            </label>
            <input
              name="payPeriodAnchorDate"
              type="date"
              defaultValue={anchorStr}
              required
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <p className="mt-1 text-xs text-zinc-400">
              Pick any Monday (weekly/bi-weekly) or the 1st/16th (semi-monthly) that was a real
              pay period start date for your company.
            </p>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            Save Settings
          </button>
        </form>
      </section>

      {/* Generate Next Period */}
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Generate Next Pay Period
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Creates the next consecutive pay period after the most recent one in
          the system (or the current period if none exist).
        </p>

        {nextPreview && (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <span className="text-zinc-500 dark:text-zinc-400">Next period: </span>
            <span className="font-medium text-zinc-900 dark:text-white">
              {format(nextPreview.startDate, "MMM d, yyyy")} –{" "}
              {format(nextPreview.endDate, "MMM d, yyyy")}
            </span>
          </div>
        )}

        <form action={handleGenerate} className="mt-4">
          <button
            type="submit"
            disabled={!payPeriodAnchorDate}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            Generate Pay Period
          </button>
          {!payPeriodAnchorDate && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Save an anchor date above before generating.
            </p>
          )}
        </form>
      </section>

      <div className="mt-4 text-sm text-zinc-500">
        <Link href="/payroll/pay-periods" className="hover:text-zinc-900 dark:hover:text-white">
          View all pay periods →
        </Link>
      </div>
    </div>
  );
}

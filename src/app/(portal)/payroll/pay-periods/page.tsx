import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { getPayPeriods, getPayPeriodDetail } from "@/actions/pay-period.actions";
import { getAdpConfig } from "@/lib/integrations/adp/client";
import { PAY_PERIOD_STATUS_LABEL, TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/labels";
import { PayPeriodActions } from "@/components/payroll/pay-period-actions";
import { formatMinutes } from "@/lib/utils/duration";
import { format } from "date-fns";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";

const PP_BADGE: Record<string, string> = {
  OPEN:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  READY:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  LOCKED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

const TS_BADGE: Record<string, string> = {
  OPEN:             "bg-zinc-100 text-zinc-600",
  SUBMITTED:        "bg-blue-100 text-blue-700",
  SUP_APPROVED:     "bg-purple-100 text-purple-700",
  PAYROLL_APPROVED: "bg-green-100 text-green-700",
  LOCKED:           "bg-zinc-200 text-zinc-500",
};

export default async function PayPeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id: selectedId } = await searchParams;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "PAY_PERIOD_MANAGE")) redirect("/dashboard");

  const result = await getPayPeriods();
  if (!result.success) redirect("/dashboard");
  const payPeriods = result.data;

  // Fetch detail if a pay period is selected
  let detail: Awaited<ReturnType<typeof getPayPeriodDetail>>["data"] | null = null;
  let payrollRun: { id: string; exportedAt: Date | null; pushedCount: number; skippedCount: number; errorCount: number } | null = null;

  if (selectedId) {
    const detailResult = await getPayPeriodDetail({ payPeriodId: selectedId });
    if (detailResult.success) {
      detail = detailResult.data;
      payrollRun = await db.payrollRun.findUnique({
        where: { payPeriodId: selectedId },
        select: { id: true, exportedAt: true, pushedCount: true, skippedCount: true, errorCount: true },
      });
    }
  }

  const adpConfigured = getAdpConfig() !== null;

  return (
    <div className="flex items-start gap-0 -mx-6 -my-8 h-screen">
      {/* ── Left panel: list ─────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800 sticky top-0 h-screen overflow-y-auto">
        <div className="px-4 pt-6 pb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Pay Periods</h1>
          <Link
            href="/payroll/timecards"
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            Timecards
          </Link>
        </div>

        {payPeriods.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-zinc-400">No pay periods found.</p>
        )}

        <div className="flex flex-col">
          {payPeriods.map((pp) => {
            const total = pp.timesheets.length;
            const approved = pp.timesheets.filter(
              (t) => t.status === "PAYROLL_APPROVED" || t.status === "LOCKED"
            ).length;
            const isSelected = pp.id === selectedId;

            return (
              <Link
                key={pp.id}
                href={`/payroll/pay-periods?id=${pp.id}`}
                className={`flex flex-col border-b border-zinc-100 px-4 py-3 transition-colors dark:border-zinc-800 ${
                  isSelected
                    ? "bg-blue-50 dark:bg-blue-950/20 border-l-2 border-l-blue-500"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                    {format(pp.startDate, "MMM d")} – {format(pp.endDate, "MMM d, yyyy")}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${PP_BADGE[pp.status]}`}>
                    {PAY_PERIOD_STATUS_LABEL[pp.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {approved}/{total} approved
                </p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Right panel: detail ───────────────────────────────── */}
      <div className="flex-1 overflow-y-auto h-screen px-6 py-6">
        {!detail ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-400">Select a pay period to view details</p>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
                  {format(detail.payPeriod.startDate, "MMM d")} –{" "}
                  {format(detail.payPeriod.endDate, "MMM d, yyyy")}
                </h2>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`rounded-full px-3 py-0.5 text-xs font-medium ${PP_BADGE[detail.payPeriod.status]}`}>
                    {PAY_PERIOD_STATUS_LABEL[detail.payPeriod.status]}
                  </span>
                </div>
              </div>
              <PayPeriodActions
                payPeriodId={detail.payPeriod.id}
                status={detail.payPeriod.status}
                isReady={detail.validation.isReady}
                adpConfigured={adpConfigured}
                payrollRun={payrollRun}
              />
            </div>

            {/* Validation tiles */}
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Total Timesheets</p>
                <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
                  {detail.validation.totalTimesheets}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Approved</p>
                <p className="mt-1 text-2xl font-bold text-green-600">
                  {detail.validation.approvedCount}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pending / Issues</p>
                <p className={`mt-1 text-2xl font-bold ${
                  detail.validation.pendingCount > 0 || detail.validation.unresolvedExceptions > 0
                    ? "text-red-600"
                    : "text-zinc-900 dark:text-white"
                }`}>
                  {detail.validation.pendingCount + detail.validation.unresolvedExceptions}
                </p>
              </div>
            </div>

            {/* Outstanding issues */}
            {detail.validation.issues.length > 0 && (
              <div className="mt-6">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Outstanding Issues</h2>
                <ul className="mt-2 flex flex-col gap-2">
                  {detail.validation.issues.map((issue, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800/40 dark:bg-red-900/10"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      <div>
                        <span className="font-medium text-zinc-900 dark:text-white">{issue.employeeName}</span>
                        <span className="ml-2 text-zinc-600 dark:text-zinc-400">— {issue.issue}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Timesheet roster */}
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Timesheets</h2>
              <div className="mt-2 flex flex-col gap-2">
                {detail.payPeriod.timesheets.length === 0 && (
                  <p className="py-4 text-center text-sm text-zinc-400">No timesheets for this pay period.</p>
                )}
                {detail.payPeriod.timesheets.map((ts) => {
                  const reg = ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
                  const ot = ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0;
                  const dt = ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0;
                  const isApproved = ts.status === "PAYROLL_APPROVED" || ts.status === "LOCKED";
                  const hasExceptions = ts.exceptions.length > 0;

                  return (
                    <Link
                      key={ts.id}
                      href={`/payroll/timecards?payPeriodId=${detail.payPeriod.id}&employeeId=${ts.employeeId}`}
                      className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
                    >
                      <div className="flex items-center gap-3">
                        {isApproved && !hasExceptions ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : hasExceptions ? (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <Clock className="h-4 w-4 text-zinc-400" />
                        )}
                        <div>
                          <p className="font-medium text-zinc-900 dark:text-white">
                            {ts.employee.user?.name ?? `Employee ${ts.employeeId}`}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            REG {formatMinutes(reg)}
                            {ot > 0 && <span className="ml-2 text-amber-600">OT {formatMinutes(ot)}</span>}
                            {dt > 0 && <span className="ml-2 text-red-600">DT {formatMinutes(dt)}</span>}
                          </p>
                        </div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${TS_BADGE[ts.status]}`}>
                        {TIMESHEET_STATUS_LABEL[ts.status]}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

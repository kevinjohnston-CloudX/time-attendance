import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { getPayPeriodDetail } from "@/actions/pay-period.actions";
import { getAdpConfig } from "@/lib/integrations/adp/client";
import { PAY_PERIOD_STATUS_LABEL } from "@/lib/state-machines/pay-period-state";
import { TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/timesheet-state";
import { PayPeriodActions } from "@/components/payroll/pay-period-actions";
import { formatMinutes } from "@/lib/utils/duration";
import { format } from "date-fns";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";

const TS_BADGE: Record<string, string> = {
  OPEN: "bg-zinc-100 text-zinc-600",
  SUBMITTED: "bg-blue-100 text-blue-700",
  SUP_APPROVED: "bg-purple-100 text-purple-700",
  PAYROLL_APPROVED: "bg-green-100 text-green-700",
  LOCKED: "bg-zinc-200 text-zinc-500",
};

export default async function PayPeriodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "PAY_PERIOD_MANAGE")) redirect("/dashboard");

  const result = await getPayPeriodDetail({ payPeriodId: id });
  if (!result.success) notFound();

  const { payPeriod, validation } = result.data;

  // ADP integration data
  const adpConfigured = getAdpConfig() !== null;
  const payrollRun = await db.payrollRun.findUnique({
    where: { payPeriodId: id },
    select: { id: true, exportedAt: true, pushedCount: true, skippedCount: true, errorCount: true },
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/payroll/pay-periods"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          >
            ← Pay Periods
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
            {format(payPeriod.startDate, "MMM d")} –{" "}
            {format(payPeriod.endDate, "MMM d, yyyy")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {PAY_PERIOD_STATUS_LABEL[payPeriod.status]}
          </p>
        </div>

        <PayPeriodActions
          payPeriodId={payPeriod.id}
          status={payPeriod.status}
          isReady={validation.isReady}
          adpConfigured={adpConfigured}
          payrollRun={payrollRun}
        />
      </div>

      {/* Validation summary */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Total Timesheets
          </p>
          <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
            {validation.totalTimesheets}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Approved
          </p>
          <p className="mt-1 text-2xl font-bold text-green-600">
            {validation.approvedCount}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Pending / Issues
          </p>
          <p
            className={`mt-1 text-2xl font-bold ${
              validation.pendingCount > 0 || validation.unresolvedExceptions > 0
                ? "text-red-600"
                : "text-zinc-900 dark:text-white"
            }`}
          >
            {validation.pendingCount + validation.unresolvedExceptions}
          </p>
        </div>
      </div>

      {/* Outstanding issues */}
      {validation.issues.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Outstanding Issues
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {validation.issues.map((issue, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800/40 dark:bg-red-900/10"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div>
                  <span className="font-medium text-zinc-900 dark:text-white">
                    {issue.employeeName}
                  </span>
                  <span className="ml-2 text-zinc-600 dark:text-zinc-400">
                    — {issue.issue}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Timesheet roster */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Timesheets
        </h2>
        <div className="mt-2 flex flex-col gap-2">
          {payPeriod.timesheets.length === 0 && (
            <p className="py-4 text-center text-sm text-zinc-400">
              No timesheets for this pay period.
            </p>
          )}
          {payPeriod.timesheets.map((ts) => {
            const reg = ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
            const ot = ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0;
            const dt = ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0;
            const isApproved =
              ts.status === "PAYROLL_APPROVED" || ts.status === "LOCKED";
            const hasExceptions = ts.exceptions.length > 0;

            return (
              <div
                key={ts.id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
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
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${TS_BADGE[ts.status]}`}
                >
                  {TIMESHEET_STATUS_LABEL[ts.status]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

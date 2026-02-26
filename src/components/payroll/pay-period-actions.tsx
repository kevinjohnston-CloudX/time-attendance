"use client";

import { useState, useTransition } from "react";
import { markPayPeriodReady, lockPayPeriod, reopenPayPeriod } from "@/actions/pay-period.actions";
import { pushPayrollToAdp } from "@/actions/adp.actions";

interface PayrollRun {
  id: string;
  exportedAt: Date | null;
  pushedCount: number;
  skippedCount: number;
  errorCount: number;
}

interface Props {
  payPeriodId: string;
  status: "OPEN" | "READY" | "LOCKED";
  isReady: boolean;
  adpConfigured?: boolean;
  payrollRun?: PayrollRun | null;
}

export function PayPeriodActions({ payPeriodId, status, isReady, adpConfigured, payrollRun }: Props) {
  const [isPending, startTransition] = useTransition();
  const [pushResult, setPushResult] = useState<{
    pushed: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  function handleMarkReady() {
    startTransition(async () => {
      const result = await markPayPeriodReady({ payPeriodId });
      if (!result.success) alert(result.error);
    });
  }

  function handleLock() {
    if (!confirm("Lock this pay period? All approved timesheets will be locked.")) return;
    startTransition(async () => {
      const result = await lockPayPeriod({ payPeriodId });
      if (!result.success) alert(result.error);
    });
  }

  function handleReopen() {
    const reason = prompt("Reason for reopening:");
    if (!reason) return;
    startTransition(async () => {
      const result = await reopenPayPeriod({ payPeriodId, reason });
      if (!result.success) alert(result.error);
    });
  }

  function handlePushToAdp() {
    if (!confirm("Push payroll hours to ADP? This will send all locked timesheet data.")) return;
    setPushError(null);
    setPushResult(null);
    startTransition(async () => {
      const result = await pushPayrollToAdp({ payPeriodId });
      if (!result.success) {
        setPushError(result.error);
        return;
      }
      setPushResult(result.data);
    });
  }

  if (status === "LOCKED") {
    const alreadyPushed = !!payrollRun?.exportedAt;

    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={handleReopen}
            disabled={isPending}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Unlock
          </button>

          {adpConfigured && !alreadyPushed && !pushResult && (
            <button
              onClick={handlePushToAdp}
              disabled={isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Pushing…" : "Push to ADP"}
            </button>
          )}
        </div>

        {adpConfigured && alreadyPushed && !pushResult && (
          <div className="text-right">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              Pushed to ADP
            </p>
            <p className="text-xs text-zinc-500">
              {new Date(payrollRun!.exportedAt!).toLocaleString()}
              {" · "}
              {payrollRun!.pushedCount} pushed, {payrollRun!.skippedCount} skipped
              {payrollRun!.errorCount > 0 && `, ${payrollRun!.errorCount} errors`}
            </p>
          </div>
        )}

        {pushError && (
          <p className="text-sm text-red-500">{pushError}</p>
        )}

        {pushResult && (
          <div className="text-right">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              Pushed to ADP successfully
            </p>
            <p className="text-xs text-zinc-500">
              {pushResult.pushed} pushed, {pushResult.skipped} skipped
            </p>
            {pushResult.errors.length > 0 && (
              <div className="mt-1">
                {pushResult.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-500">{err}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {status === "OPEN" && (
        <button
          onClick={handleMarkReady}
          disabled={isPending || !isReady}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Mark Ready"}
        </button>
      )}
      {status === "READY" && (
        <>
          <button
            onClick={handleReopen}
            disabled={isPending}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reopen
          </button>
          <button
            onClick={handleLock}
            disabled={isPending}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {isPending ? "Locking…" : "Lock Pay Period"}
          </button>
        </>
      )}
    </div>
  );
}

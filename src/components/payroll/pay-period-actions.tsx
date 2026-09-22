"use client";

import { useState, useTransition } from "react";
import { markPayPeriodReady, lockPayPeriod, reopenPayPeriod, submitOpenTimesheets } from "@/actions/pay-period.actions";
import { pushPayrollToAdp } from "@/actions/adp.actions";
import { Button } from "@/components/ui";

/**
 * The close controls that ride in the pay period's page header.
 *
 * <p>Which buttons exist is the period's state machine, not a preference:
 * OPEN offers Mark Ready, READY offers Reopen and Lock, LOCKED offers Unlock
 * and — once ADP is configured — the payroll push. Rendering the whole set and
 * disabling the wrong ones would invite someone to click Lock on a period
 * still taking punches.
 *
 * <p>Outcomes print under the buttons rather than in a toast. "412 pushed, 3
 * skipped" is a number somebody has to reconcile against ADP, and a message
 * that disappears after three seconds is a number they have to ask for again.
 */

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
  isPast: boolean;
  adpConfigured?: boolean;
  payrollRun?: PayrollRun | null;
}

/** One line of outcome under the buttons, in the tone of what happened. */
function Note({ tone, children }: { tone: "error" | "success" | "muted"; children: React.ReactNode }) {
  const color =
    tone === "error"
      ? "var(--text-error)"
      : tone === "success"
        ? "var(--text-success)"
        : "var(--text-secondary)";
  return (
    <p
      className="text-right"
      style={{ margin: 0, font: "var(--type-body2)", color, textWrap: "pretty" }}
    >
      {children}
    </p>
  );
}

export function PayPeriodActions({ payPeriodId, status, isReady, isPast, adpConfigured, payrollRun }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ submitted: number } | null>(null);
  const [pushResult, setPushResult] = useState<{
    pushed: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  function handleMarkReady() {
    setError(null);
    startTransition(async () => {
      const result = await markPayPeriodReady({ payPeriodId });
      if (!result.success) setError(result.error);
    });
  }

  function handleLock() {
    if (!confirm("Lock this pay period? All approved timesheets will be locked.")) return;
    setError(null);
    startTransition(async () => {
      const result = await lockPayPeriod({ payPeriodId });
      if (!result.success) setError(result.error);
    });
  }

  function handleReopen() {
    const reason = prompt("Reason for reopening:");
    if (!reason) return;
    setError(null);
    startTransition(async () => {
      const result = await reopenPayPeriod({ payPeriodId, reason });
      if (!result.success) setError(result.error);
    });
  }

  function handleSubmitOpen() {
    if (!confirm("Move all open and submitted timesheets to Supervisor Approved for this pay period?")) return;
    setError(null);
    setSubmitResult(null);
    startTransition(async () => {
      const result = await submitOpenTimesheets({ payPeriodId });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSubmitResult(result.data);
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
        <div className="flex items-center gap-2">
          <Button hierarchy="secondary" onClick={handleReopen} disabled={isPending}>
            Unlock
          </Button>

          {adpConfigured && !alreadyPushed && !pushResult && (
            <Button onClick={handlePushToAdp} disabled={isPending}>
              {isPending ? "Pushing…" : "Push to ADP"}
            </Button>
          )}
        </div>

        {error && <Note tone="error">{error}</Note>}

        {adpConfigured && alreadyPushed && !pushResult && (
          <div className="flex flex-col items-end gap-0.5">
            <Note tone="success">Pushed to ADP</Note>
            <Note tone="muted">
              <span className="tabular">{new Date(payrollRun!.exportedAt!).toLocaleString()}</span>
              {" · "}
              {payrollRun!.pushedCount} pushed, {payrollRun!.skippedCount} skipped
              {payrollRun!.errorCount > 0 && `, ${payrollRun!.errorCount} errors`}
            </Note>
          </div>
        )}

        {pushError && <Note tone="error">{pushError}</Note>}

        {pushResult && (
          <div className="flex flex-col items-end gap-0.5">
            <Note tone="success">Pushed to ADP successfully</Note>
            <Note tone="muted">
              {pushResult.pushed} pushed, {pushResult.skipped} skipped
            </Note>
            {pushResult.errors.map((err, i) => (
              <Note key={i} tone="error">
                {err}
              </Note>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {status === "OPEN" && isPast && (
          <Button hierarchy="secondary" onClick={handleSubmitOpen} disabled={isPending}>
            {isPending ? "Approving…" : "Approve Open Timesheets"}
          </Button>
        )}
        {status === "OPEN" && (
          /* Amber, not accent: marking a period ready is the step that stops
             supervisors editing it, and the design reserves the accent fill for
             the safe default action.

             Disabled until the close checklist is clear, with the reason in the
             tooltip — a button that is simply grey is how someone concludes
             the screen is broken. */
          <Button
            tone="warning"
            onClick={handleMarkReady}
            disabled={isPending || !isReady}
            title={isReady ? undefined : "Clear every blocking item below before marking the period ready"}
          >
            {isPending ? "Saving…" : "Mark Ready"}
          </Button>
        )}
        {status === "READY" && (
          <>
            <Button hierarchy="secondary" onClick={handleReopen} disabled={isPending}>
              Reopen
            </Button>
            <Button tone="success" onClick={handleLock} disabled={isPending}>
              {isPending ? "Locking…" : "Lock Pay Period"}
            </Button>
          </>
        )}
      </div>

      {error && <Note tone="error">{error}</Note>}
      {submitResult && (
        <Note tone="success">
          {submitResult.submitted === 0
            ? "No open timesheets found."
            : `${submitResult.submitted} timesheet${submitResult.submitted !== 1 ? "s" : ""} moved to pending.`}
        </Note>
      )}
    </div>
  );
}

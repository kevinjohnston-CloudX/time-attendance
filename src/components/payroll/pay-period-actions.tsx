"use client";

import { useState, useTransition } from "react";
import { LockOpen } from "lucide-react";
import { lockPayPeriod, reopenPayPeriod } from "@/actions/pay-period.actions";
import { pushPayrollToAdp } from "@/actions/adp.actions";
import { Button, ConfirmDialog, Textarea, Toast, useToast } from "@/components/ui";
import { PpDialog } from "@/components/payroll/pp-dialog";

/**
 * The close controls in the pay period's header, with the handoff's windows:
 * a confirm before Lock and Push to ADP, and a reason window before Reopen
 * and Unlock.
 *
 * <p>Which buttons exist is the period's state machine, not a preference:
 * OPEN offers Lock, a legacy READY period offers Reopen and Lock, LOCKED
 * offers Unlock and, once ADP is configured, the payroll push. Unresolved
 * exceptions and a period that has not ended yet are warnings in the Lock
 * confirm, never a reason to refuse it.
 *
 * <p>Counts print under the buttons rather than in a toast. "412 pushed, 3
 * skipped" is a number somebody has to reconcile against ADP, and a message
 * that disappears after three seconds is a number they have to ask for again.
 * A plain change of state (locked, unlocked) is a toast, since the badge
 * beside the title already shows it.
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
  /** "Sep 1 to Sep 30, 2026", for the windows and the toasts. */
  label: string;
  status: "OPEN" | "READY" | "LOCKED";
  isPast: boolean;
  /** Lock, unlock and the ADP push are PAYROLL_RUN; without it only `leading` is drawn. */
  canRunPayroll: boolean;
  /** Unresolved exceptions in the period, warned about before locking. */
  exceptions?: number;
  adpConfigured?: boolean;
  payrollRun?: PayrollRun | null;
  /** Buttons drawn first in the same row (Export to ADP, Reports). */
  leading?: React.ReactNode;
}

type Confirm = "lock" | "push";

const CONFIRM: Record<Confirm, { title: string; text: string; label: string; pending: string; tone: "info" | "warning" }> = {
  lock: {
    title: "Lock pay period?",
    text: "Every timesheet in this period is locked, and the period's accruals and approved leave are posted.",
    label: "Lock Pay Period",
    pending: "Locking…",
    tone: "warning",
  },
  push: {
    title: "Push to ADP?",
    text: "Sends the hours on every locked timesheet in this period to ADP.",
    label: "Push to ADP",
    pending: "Pushing…",
    tone: "warning",
  },
};

/** One line of outcome under the buttons, in the tone of what happened. */
function Note({ tone, children }: { tone: "error" | "success" | "muted"; children: React.ReactNode }) {
  const color = tone === "error" ? "var(--text-error)" : tone === "success" ? "var(--text-success)" : "var(--text-tertiary)";
  return (
    <p className="text-right" style={{ margin: 0, font: "var(--type-body2)", color, textWrap: "pretty" }}>
      {children}
    </p>
  );
}

export function PayPeriodActions({ payPeriodId, label, status, isPast, canRunPayroll, exceptions = 0, adpConfigured, payrollRun, leading }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [reopen, setReopen] = useState(false);
  const [reason, setReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{ pushed: number; skipped: number; errors: string[] } | null>(null);
  const { message, flash } = useToast();

  function handleConfirm() {
    if (!confirm) return;
    const kind = confirm;
    setConfirmError(null);
    startTransition(async () => {
      if (kind === "lock") {
        const result = await lockPayPeriod({ payPeriodId });
        if (!result.success) return setConfirmError(result.error);
        flash(`${label} locked`);
      } else {
        const result = await pushPayrollToAdp({ payPeriodId });
        if (!result.success) return setConfirmError(result.error);
        setPushResult(result.data);
      }
      setConfirm(null);
    });
  }

  function handleReopen() {
    const why = reason.trim();
    if (!why) return;
    const was = status;
    setReopenError(null);
    startTransition(async () => {
      const result = await reopenPayPeriod({ payPeriodId, reason: why });
      if (!result.success) return setReopenError(result.error);
      setReopen(false);
      setReason("");
      flash(`${label} ${was === "LOCKED" ? "unlocked" : "reopened"}`);
    });
  }

  const ask = (kind: Confirm) => {
    setConfirmError(null);
    setConfirm(kind);
  };
  const askReopen = () => {
    setReopenError(null);
    setReason("");
    setReopen(true);
  };

  const alreadyPushed = !!payrollRun?.exportedAt;
  const reopenWord = status === "LOCKED" ? "Unlock" : "Reopen";

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {leading}
        {canRunPayroll && status === "READY" && (
          <Button hierarchy="secondary" onClick={askReopen} disabled={isPending}>
            Reopen
          </Button>
        )}
        {canRunPayroll && (status === "OPEN" || status === "READY") && (
          <Button tone="success" onClick={() => ask("lock")} disabled={isPending}>
            Lock Pay Period
          </Button>
        )}
        {canRunPayroll && status === "LOCKED" && (
          <>
            <Button hierarchy="secondary" onClick={askReopen} disabled={isPending}>
              Unlock
            </Button>
            {adpConfigured && !alreadyPushed && !pushResult && (
              <Button onClick={() => ask("push")} disabled={isPending}>
                Push to ADP
              </Button>
            )}
          </>
        )}
      </div>

      {status === "LOCKED" && adpConfigured && alreadyPushed && !pushResult && (
        <Note tone="success">
          Pushed to ADP{" "}
          <span style={{ color: "var(--text-tertiary)" }}>
            · <span className="tabular">{new Date(payrollRun!.exportedAt!).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span> ·{" "}
            {payrollRun!.pushedCount} pushed, {payrollRun!.skippedCount} skipped
            {payrollRun!.errorCount > 0 && `, ${payrollRun!.errorCount} errors`}
          </span>
        </Note>
      )}
      {pushResult && (
        <>
          <Note tone="success">
            Pushed to ADP successfully{" "}
            <span style={{ color: "var(--text-tertiary)" }}>
              · {pushResult.pushed} pushed, {pushResult.skipped} skipped
            </span>
          </Note>
          {pushResult.errors.map((err, i) => (
            <Note key={i} tone="error">
              {err}
            </Note>
          ))}
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title={CONFIRM[confirm].title}
          tone={CONFIRM[confirm].tone}
          confirmLabel={CONFIRM[confirm].label}
          pendingLabel={CONFIRM[confirm].pending}
          pending={isPending}
          error={confirmError}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        >
          {CONFIRM[confirm].text}
          {confirm === "lock" && !isPast && " This period has not ended yet."}
          {confirm === "lock" && exceptions > 0 &&
            ` ${exceptions.toLocaleString("en-US")} unresolved ${exceptions === 1 ? "exception is" : "exceptions are"} still open, like a missed punch. Locking does not wait for them.`}
        </ConfirmDialog>
      )}

      {reopen && (
        <PpDialog
          icon={<LockOpen className="h-[18px] w-[18px]" aria-hidden />}
          title={`${reopenWord} pay period`}
          subtitle={label}
          width={460}
          pending={isPending}
          onClose={() => setReopen(false)}
          footer={
            <>
              <Button hierarchy="secondary" onClick={() => setReopen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button tone="warning" onClick={handleReopen} disabled={isPending || !reason.trim()}>
                {isPending ? (status === "LOCKED" ? "Unlocking…" : "Reopening…") : reopenWord}
              </Button>
            </>
          }
        >
          <Textarea
            label={status === "LOCKED" ? "Reason for unlocking" : "Reason for reopening"}
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Missed punches found after the close"
            hint={
              status === "LOCKED"
                ? "Saved to the audit log with your name. Locked timesheets go back to Open."
                : "Saved to the audit log with your name."
            }
            error={reopenError ?? undefined}
          />
        </PpDialog>
      )}

      <Toast message={message} />
    </>
  );
}

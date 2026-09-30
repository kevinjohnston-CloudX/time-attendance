"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { lockTimesheet, unlockTimesheet } from "@/actions/timesheet.actions";
import { Button, ConfirmDialog, Textarea } from "@/components/ui";
import { PpDialog } from "@/components/payroll/pp-dialog";

/**
 * Unlock one person's timecard inside a locked pay period, and lock it again
 * once corrected. The period itself stays locked throughout.
 */
export function TimecardLockControl({
  timesheetId,
  status,
  periodStatus,
  employeeName,
}: {
  timesheetId: string;
  status: string;
  periodStatus: string;
  employeeName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"unlock" | "lock" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canUnlock = status === "LOCKED";
  const canLock = status !== "LOCKED" && periodStatus === "LOCKED";
  if (!canUnlock && !canLock) return null;

  function open(kind: "unlock" | "lock") {
    setError(null);
    setReason("");
    setDialog(kind);
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const result =
        dialog === "unlock"
          ? await unlockTimesheet({ timesheetId, reason: reason.trim() })
          : await lockTimesheet({ timesheetId });
      if (!result.success) return setError(result.error);
      setDialog(null);
      router.refresh();
    });
  }

  return (
    <>
      {canUnlock ? (
        <Button
          hierarchy="secondary"
          size="sm"
          leadingIcon={<LockOpen className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => open("unlock")}
          disabled={isPending}
        >
          Unlock timecard
        </Button>
      ) : (
        <Button
          tone="success"
          size="sm"
          leadingIcon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => open("lock")}
          disabled={isPending}
        >
          Lock timecard
        </Button>
      )}

      {dialog === "unlock" && (
        <PpDialog
          icon={<LockOpen className="h-[18px] w-[18px]" aria-hidden />}
          title="Unlock timecard"
          subtitle={employeeName}
          width={460}
          pending={isPending}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button hierarchy="secondary" onClick={() => setDialog(null)} disabled={isPending}>
                Cancel
              </Button>
              <Button tone="warning" onClick={run} disabled={isPending || !reason.trim()}>
                {isPending ? "Unlocking…" : "Unlock"}
              </Button>
            </>
          }
        >
          <Textarea
            label="Reason for unlocking"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Missed punch found after the close"
            hint="Saved to the audit log with your name. Only this timecard opens; the pay period stays locked. Lock it again when you're done."
          />
          {error && (
            <p className="m-0 mt-2" style={{ font: "var(--type-body2)", color: "var(--text-error)" }}>
              {error}
            </p>
          )}
        </PpDialog>
      )}

      {dialog === "lock" && (
        <ConfirmDialog
          title="Lock timecard?"
          tone="warning"
          confirmLabel="Lock timecard"
          pendingLabel="Locking…"
          pending={isPending}
          error={error}
          onConfirm={run}
          onCancel={() => setDialog(null)}
        >
          {employeeName}&apos;s timecard is locked again and can no longer be edited.
        </ConfirmDialog>
      )}
    </>
  );
}

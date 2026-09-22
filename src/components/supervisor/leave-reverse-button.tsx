"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { reverseLeaveApproval } from "@/actions/leave.actions";

/**
 * Undo an approval that has already been given.
 *
 * <p>Confirmed rather than immediate, because this is not undoing a click: the
 * request goes back to pending and the hours go back onto the balance, and
 * somebody may already have planned a shift around the day being covered.
 * The warning tone is the honest one — nothing is destroyed, but a settled
 * record stops being settled.
 */

interface Props {
  leaveRequestId: string;
  label?: string;
}

export function LeaveReverseButton({ leaveRequestId, label = "Reverse Approval" }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleReverse() {
    setError(null);
    startTransition(async () => {
      const result = await reverseLeaveApproval({ leaveRequestId });
      if (!result.success) setError("Failed to reverse approval.");
      else setConfirm(false);
    });
  }

  if (confirm) {
    return (
      <div className="flex flex-col gap-2">
        {error && (
          <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</p>
        )}
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
          This moves the request back to pending and restores the balance.
        </p>
        <div className="flex items-center gap-2">
          <Button hierarchy="tertiary" size="sm" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button size="sm" tone="warning" onClick={handleReverse} disabled={isPending}>
            {isPending ? "Saving…" : "Confirm"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button hierarchy="secondary" size="sm" onClick={() => setConfirm(true)} disabled={isPending}>
        {label}
      </Button>
      {error && (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</p>
      )}
    </div>
  );
}

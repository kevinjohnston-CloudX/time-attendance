"use client";

import { useState, useTransition } from "react";
import { cancelLeaveRequest } from "@/actions/leave.actions";
import { Button, ConfirmDialog } from "@/components/ui";

interface Props {
  leaveRequestId: string;
}

/**
 * Cancel one of your own pending requests.
 *
 * <p>A link-weight error button rather than a filled red one: it sits in the
 * last cell of every pending row, and a table of red buttons reads as a table
 * of problems. On a phone, where the row is a card, it is a full width
 * outlined button at the card's foot, so it is big enough to tap. The confirm
 * stays (the request is gone from the supervisor's queue the moment this
 * succeeds), in the app's own window rather than the browser's.
 */
export function CancelLeaveButton({ leaveRequestId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelLeaveRequest({ leaveRequestId });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setConfirming(false);
    });
  }

  const label = isPending ? "Cancelling…" : "Cancel request";

  return (
    <div className="inline-flex flex-col items-end gap-0.5 max-md:w-full">
      <span className="ta-desktop-only">
        <Button hierarchy="link" tone="error" size="sm" disabled={isPending} onClick={() => setConfirming(true)}>
          {label}
        </Button>
      </span>
      <span className="ta-phone-only">
        <Button hierarchy="secondary" tone="error" disabled={isPending} onClick={() => setConfirming(true)} style={{ width: "100%" }}>
          {label}
        </Button>
      </span>
      {error && !confirming && (
        <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{error}</span>
      )}
      {confirming && (
        <ConfirmDialog
          title="Cancel this leave request?"
          confirmLabel="Cancel request"
          pendingLabel="Cancelling…"
          pending={isPending}
          error={error}
          onConfirm={handleCancel}
          onCancel={() => setConfirming(false)}
        >
          It comes off your supervisor&rsquo;s list right away. To take the time off later, request it again.
        </ConfirmDialog>
      )}
    </div>
  );
}

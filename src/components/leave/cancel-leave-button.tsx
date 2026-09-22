"use client";

import { useState, useTransition } from "react";
import { cancelLeaveRequest } from "@/actions/leave.actions";
import { Button } from "@/components/ui";

interface Props {
  leaveRequestId: string;
}

/**
 * Cancel one of your own pending requests.
 *
 * <p>A link-weight error button rather than a filled red one: it sits in the
 * last cell of every pending row, and a table of red buttons reads as a table
 * of problems. The confirm stays — the request is gone from the supervisor's
 * queue the moment this succeeds.
 */
export function CancelLeaveButton({ leaveRequestId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    if (!confirm("Cancel this leave request?")) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelLeaveRequest({ leaveRequestId });
      if (!result.success) setError(result.error);
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <Button
        hierarchy="link"
        tone="error"
        size="sm"
        disabled={isPending}
        onClick={handleCancel}
      >
        {isPending ? "Cancelling…" : "Cancel request"}
      </Button>
      {error && (
        <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{error}</span>
      )}
    </div>
  );
}

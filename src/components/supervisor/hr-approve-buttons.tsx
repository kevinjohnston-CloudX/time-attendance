"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import { hrApproveLeaveRequest, rejectLeaveRequest } from "@/actions/leave.actions";

/**
 * The second signature on a leave request: HR's.
 *
 * <p>The reject path is the same server action the supervisor uses, so a
 * request HR turns down goes back to the employee with a reason rather than
 * back down the chain — which is why the note is required here too.
 */

interface Props {
  leaveRequestId: string;
}

export function HrApproveButtons({ leaveRequestId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await hrApproveLeaveRequest({ leaveRequestId });
      if (!result.success) setError("Failed to approve.");
    });
  }

  function handleReject() {
    if (!rejectMode) { setRejectMode(true); return; }
    if (!rejectNote.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await rejectLeaveRequest({ leaveRequestId, reviewNote: rejectNote });
      if (!result.success) setError(result.error);
    });
  }

  if (rejectMode) {
    return (
      <div className="flex flex-col gap-2">
        {error && (
          <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</p>
        )}
        <Input
          autoFocus
          size="sm"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="Reason for rejection…"
        />
        <div className="flex items-center gap-2">
          <Button hierarchy="tertiary" size="sm" onClick={() => setRejectMode(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            tone="error"
            onClick={handleReject}
            disabled={isPending || !rejectNote.trim()}
          >
            {isPending ? "Saving…" : "Confirm Reject"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={handleApprove} disabled={isPending}>
        {isPending ? "Saving…" : "HR Approve"}
      </Button>
      <Button hierarchy="secondary" size="sm" onClick={() => setRejectMode(true)} disabled={isPending}>
        Reject
      </Button>
      {error && (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</p>
      )}
    </div>
  );
}

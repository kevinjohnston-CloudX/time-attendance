"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import { approveLeaveRequest, rejectLeaveRequest } from "@/actions/leave.actions";

/**
 * The supervisor's decision on one pending leave request.
 *
 * <p>Rejecting is deliberately two steps. The reason is required and is stored
 * as the review note the employee reads, so a one-click reject would have to
 * either invent that note or leave somebody with a refused day off and nothing
 * saying why.
 *
 * <p>Approve is the plain accent button rather than a green one. Green here
 * would be the only green action in the product, and on a row that already
 * carries a green "Approved" pill it reads as a status rather than a control.
 */

interface Props {
  leaveRequestId: string;
}

export function LeaveApprovalButtons({ leaveRequestId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveLeaveRequest({ leaveRequestId });
      if (!result.success) setError(result.error);
    });
  }

  function handleReject() {
    if (!rejectMode) {
      setRejectMode(true);
      return;
    }
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
        {isPending ? "Saving…" : "Approve"}
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

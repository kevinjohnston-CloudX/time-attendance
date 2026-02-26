"use client";

import { useState, useTransition } from "react";
import { approveLeaveRequest, rejectLeaveRequest } from "@/actions/leave.actions";

interface Props {
  leaveRequestId: string;
}

export function LeaveApprovalButtons({ leaveRequestId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  function handleApprove() {
    startTransition(async () => {
      const result = await approveLeaveRequest({ leaveRequestId });
      if (!result.success) alert(result.error);
    });
  }

  function handleReject() {
    if (!rejectMode) {
      setRejectMode(true);
      return;
    }
    if (!rejectNote.trim()) return;
    startTransition(async () => {
      const result = await rejectLeaveRequest({ leaveRequestId, reviewNote: rejectNote });
      if (!result.success) alert(result.error);
    });
  }

  if (rejectMode) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="Reason for rejection…"
          className="w-52 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        <button
          onClick={() => setRejectMode(false)}
          className="text-sm text-zinc-400 hover:text-zinc-600"
        >
          Cancel
        </button>
        <button
          onClick={handleReject}
          disabled={isPending || !rejectNote.trim()}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Confirm Reject"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setRejectMode(true)}
        disabled={isPending}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Reject
      </button>
      <button
        onClick={handleApprove}
        disabled={isPending}
        className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Approve"}
      </button>
    </div>
  );
}

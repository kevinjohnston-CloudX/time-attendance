"use client";

import { useState, useTransition } from "react";
import { reverseLeaveApproval } from "@/actions/leave.actions";

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
      <div className="flex flex-col gap-2 mt-2">
        {error && <p className="text-xs text-red-500">{error}</p>}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          This will move the request back to pending and restore the balance.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleReverse}
            disabled={isPending}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2">
      {error && <p className="text-xs text-red-500 mb-1">{error}</p>}
      <button
        type="button"
        onClick={() => setConfirm(true)}
        disabled={isPending}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        {label}
      </button>
    </div>
  );
}

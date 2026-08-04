"use client";

import { useState, useTransition } from "react";
import { cancelLeaveRequest } from "@/actions/leave.actions";

interface Props {
  leaveRequestId: string;
}

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
    <div>
      <button
        onClick={handleCancel}
        disabled={isPending}
        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
      >
        {isPending ? "Cancelling…" : "Cancel request"}
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

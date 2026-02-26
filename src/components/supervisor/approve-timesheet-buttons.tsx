"use client";

import { useTransition } from "react";
import { approveTimesheet, rejectTimesheet } from "@/actions/timesheet.actions";

interface Props {
  timesheetId: string;
  status: string;
  isPayroll?: boolean;
}

export function ApproveTimesheetButtons({ timesheetId, status, isPayroll }: Props) {
  const [isPending, startTransition] = useTransition();

  const canApprove = isPayroll ? status === "SUP_APPROVED" : status === "SUBMITTED";
  const canReject = status === "SUBMITTED" || status === "SUP_APPROVED";

  if (!canApprove && !canReject) return null;

  function handleApprove() {
    startTransition(async () => {
      const result = await approveTimesheet({ timesheetId });
      if (!result.success) alert(result.error);
    });
  }

  function handleReject() {
    const note = prompt("Reason for rejection:");
    if (!note) return;
    startTransition(async () => {
      const result = await rejectTimesheet({ timesheetId, note });
      if (!result.success) alert(result.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {canReject && (
        <button
          onClick={handleReject}
          disabled={isPending}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reject
        </button>
      )}
      {canApprove && (
        <button
          onClick={handleApprove}
          disabled={isPending}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Approve"}
        </button>
      )}
    </div>
  );
}

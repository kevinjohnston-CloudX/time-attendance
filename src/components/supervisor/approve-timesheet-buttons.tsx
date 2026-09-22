"use client";

import { useState, useTransition } from "react";
import { approveTimesheet, rejectTimesheet } from "@/actions/timesheet.actions";
import { Button } from "@/components/ui";

/**
 * The approve / reject pair that sits at the end of a queue row.
 *
 * <p>Both buttons were hand-rolled zinc-and-green Tailwind with their own
 * `dark:` variants, which is why the green here matched no other green in the
 * product and why the pair sat a few pixels taller than every other control on
 * the screen. They are the design system's Button now, at `sm` so the row
 * keeps its 40px.
 *
 * <p>Which button a row gets is unchanged — a supervisor acts on SUBMITTED,
 * payroll on SUP_APPROVED — and so is the note prompt. A modal would be the
 * design's answer to asking for a rejection reason, but swapping the prompt
 * changes what happens when somebody dismisses it, and that is the difference
 * between a returned timesheet and a silently untouched one.
 */

interface Props {
  timesheetId: string;
  status: string;
  isPayroll?: boolean;
}

export function ApproveTimesheetButtons({ timesheetId, status, isPayroll }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canApprove = isPayroll ? status === "SUP_APPROVED" : status === "SUBMITTED";
  const canReject = status === "SUBMITTED" || status === "SUP_APPROVED";

  if (!canApprove && !canReject) return null;

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveTimesheet({ timesheetId });
      if (!result.success) setError(result.error);
    });
  }

  function handleReject() {
    const note = prompt("Reason for rejection:");
    if (!note) return;
    setError(null);
    startTransition(async () => {
      const result = await rejectTimesheet({ timesheetId, note });
      if (!result.success) setError(result.error);
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error && (
        <span
          role="alert"
          style={{ font: "var(--type-caption1)", color: "var(--text-error)", textWrap: "pretty" }}
        >
          {error}
        </span>
      )}
      {canReject && (
        <Button hierarchy="secondary" size="sm" disabled={isPending} onClick={handleReject}>
          Reject
        </Button>
      )}
      {canApprove && (
        <Button size="sm" disabled={isPending} onClick={handleApprove}>
          {isPending ? "Saving…" : "Approve"}
        </Button>
      )}
    </div>
  );
}

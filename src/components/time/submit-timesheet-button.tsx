"use client";

import { useState, useTransition } from "react";
import { submitTimesheet } from "@/actions/timesheet.actions";
import { Button } from "@/components/ui";

/**
 * Submit my own timesheet for approval.
 *
 * <p>The kit's Button rather than a hand-rolled one: this was the last primary
 * action in the product still painting its own fill and its own hover, and it
 * sat a few pixels taller than every control beside it.
 *
 * <p>Small by default because both places it appears are compact rows — the
 * dashboard's Pay Period card, next to a small "Open Timesheet", and the
 * timesheet viewer's header strip. A page header that leads with this action
 * should ask for `md`.
 */
export function SubmitTimesheetButton({
  timesheetId,
  size = "sm",
}: {
  timesheetId: string;
  size?: "sm" | "md";
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await submitTimesheet({ timesheetId });
      if (!result.success) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size={size} disabled={isPending} onClick={handleSubmit}>
        {isPending ? "Submitting…" : "Submit for Approval"}
      </Button>
      {/* Submission is refused whenever an exception is still open, and the
          reason names how many — so it gets room to wrap rather than a line
          that runs off the card. */}
      {error && (
        <p
          style={{
            margin: 0,
            font: "var(--type-caption1)",
            color: "var(--text-error)",
            textAlign: "right",
            textWrap: "pretty",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

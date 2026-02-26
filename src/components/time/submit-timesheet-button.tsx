"use client";

import { useState, useTransition } from "react";
import { submitTimesheet } from "@/actions/timesheet.actions";

export function SubmitTimesheetButton({ timesheetId }: { timesheetId: string }) {
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
      <button
        onClick={handleSubmit}
        disabled={isPending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isPending ? "Submitting…" : "Submit for Approval"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

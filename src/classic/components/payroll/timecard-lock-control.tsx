"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lockTimesheet, unlockTimesheet } from "@/actions/timesheet.actions";

/** Unlock one timecard inside a locked pay period, and lock it again after. */
export function TimecardLockControl({
  timesheetId,
  status,
  periodStatus,
}: {
  timesheetId: string;
  status: string;
  periodStatus: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canUnlock = status === "LOCKED";
  const canLock = status !== "LOCKED" && periodStatus === "LOCKED";
  if (!canUnlock && !canLock) return null;

  function handleUnlock() {
    const reason = prompt("Reason for unlocking this timecard (saved to the audit log). The pay period stays locked.");
    if (!reason?.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await unlockTimesheet({ timesheetId, reason: reason.trim() });
      if (!result.success) return setError(result.error);
      router.refresh();
    });
  }

  function handleLock() {
    if (!confirm("Lock this timecard again? It can no longer be edited.")) return;
    setError(null);
    startTransition(async () => {
      const result = await lockTimesheet({ timesheetId });
      if (!result.success) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <>
      {canUnlock ? (
        <button
          onClick={handleUnlock}
          disabled={isPending}
          className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {isPending ? "Unlocking…" : "Unlock Timecard"}
        </button>
      ) : (
        <>
          <span className="text-xs text-amber-600 dark:text-amber-400">Unlocked while the pay period is locked</span>
          <button
            onClick={handleLock}
            disabled={isPending}
            className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isPending ? "Locking…" : "Lock Timecard"}
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </>
  );
}

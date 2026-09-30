"use client";

import { useState, useTransition } from "react";
import { addManualPunchPair, addPayrollLeaveEntry } from "@/actions/timecard-entry.actions";
import { minutesToHoursDecimal } from "@/lib/utils/duration";

type LeaveTypeOption = {
  id: string;
  name: string;
  category: string;
  isPaid: boolean;
};

interface AddTimecardEntryProps {
  timesheetId: string;
  date: string; // yyyy-MM-dd
  leaveTypes: LeaveTypeOption[];
  onClose: () => void;
  onSuccess: () => void;
}

export function AddTimecardEntry({
  timesheetId,
  date,
  leaveTypes,
  onClose,
  onSuccess,
}: AddTimecardEntryProps) {
  const [tab, setTab] = useState<"time" | "leave">("time");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Time entry state
  const [inTime, setInTime] = useState(`${date}T09:00`);
  const [outTime, setOutTime] = useState(`${date}T17:00`);
  const [reason, setReason] = useState("");

  // Leave entry state
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [durationHours, setDurationHours] = useState("8");
  const [leaveNote, setLeaveNote] = useState("");

  function handleAddTime(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addManualPunchPair({
        timesheetId,
        date,
        inTime: new Date(inTime).toISOString(),
        outTime: new Date(outTime).toISOString(),
        reason,
      });
      if (!result.success) {
        setError((result as { success: false; error: string }).error);
        return;
      }
      onSuccess();
    });
  }

  function handleAddLeave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const durationMinutes = Math.round(parseFloat(durationHours) * 60);
    if (isNaN(durationMinutes) || durationMinutes <= 0) {
      setError("Duration must be greater than 0.");
      return;
    }
    startTransition(async () => {
      const result = await addPayrollLeaveEntry({
        timesheetId,
        date,
        leaveTypeId,
        durationMinutes,
        note: leaveNote || undefined,
      });
      if (!result.success) {
        setError((result as { success: false; error: string }).error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div
      className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/60 dark:bg-blue-950/20"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Tabs */}
      <div className="mb-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setTab("time"); setError(null); }}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            tab === "time"
              ? "bg-blue-600 text-white"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          Add Time
        </button>
        <button
          type="button"
          onClick={() => { setTab("leave"); setError(null); }}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            tab === "leave"
              ? "bg-violet-600 text-white"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          Add Leave
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>

      {/* Add Time form */}
      {tab === "time" && (
        <form onSubmit={handleAddTime} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              In
            </span>
            <input
              type="datetime-local"
              value={inTime}
              onChange={(e) => setInTime(e.target.value)}
              required
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Out
            </span>
            <input
              type="datetime-local"
              value={outTime}
              onChange={(e) => setOutTime(e.target.value)}
              required
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Reason
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being added manually?"
              required
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <button
            type="submit"
            disabled={isPending || !reason.trim()}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Add"}
          </button>
          {error && <span className="w-full text-xs text-red-500">{error}</span>}
        </form>
      )}

      {/* Add Leave form */}
      {tab === "leave" && (
        <form onSubmit={handleAddLeave} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Leave Type
            </span>
            <select
              value={leaveTypeId}
              onChange={(e) => setLeaveTypeId(e.target.value)}
              required
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            >
              {leaveTypes.length === 0 && (
                <option value="">No leave types configured</option>
              )}
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}{lt.isPaid ? "" : " (Unpaid)"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Hours
            </span>
            <input
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              required
              className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Note (optional)
            </span>
            <input
              type="text"
              value={leaveNote}
              onChange={(e) => setLeaveNote(e.target.value)}
              placeholder="e.g. FMLA paperwork ref #…"
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-400">
              {durationHours && !isNaN(parseFloat(durationHours))
                ? `= ${minutesToHoursDecimal(Math.round(parseFloat(durationHours) * 60))}h`
                : ""}
            </span>
            <button
              type="submit"
              disabled={isPending || !leaveTypeId || !durationHours}
              className="rounded bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Add"}
            </button>
          </div>
          {error && <span className="w-full text-xs text-red-500">{error}</span>}
        </form>
      )}
    </div>
  );
}

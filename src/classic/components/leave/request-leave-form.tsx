"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLeaveRequest, submitLeaveRequest } from "@/actions/leave.actions";
import { LeaveDayPicker, type DaySelection, type ShiftInfo } from "./leave-day-picker";

interface Props {
  leaveTypes: { id: string; name: string }[];
  shift: ShiftInfo | null;
  onSuccess?: () => void;
}

export function RequestLeaveForm({ leaveTypes, shift, onSuccess }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [selectedDays, setSelectedDays] = useState<DaySelection[]>([]);
  const [note, setNote] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedDays.length === 0) {
      setError("Select at least one day.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const createResult = await createLeaveRequest({
        leaveTypeId,
        selectedDays,
        note: note || undefined,
      });

      if (!createResult.success) {
        setError(createResult.error);
        return;
      }

      const submitResult = await submitLeaveRequest({
        leaveRequestId: createResult.data.id,
      });

      if (!submitResult.success) {
        setError(submitResult.error);
        return;
      }

      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/leave");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Leave Type
        </label>
        <select
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          required
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          {leaveTypes.map((lt) => (
            <option key={lt.id} value={lt.id}>
              {lt.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Select Days
        </label>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <LeaveDayPicker value={selectedDays} onChange={setSelectedDays} shift={shift} />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Note <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Reason or additional context…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
      </div>

      <button
        type="submit"
        disabled={isPending || selectedDays.length === 0}
        className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Submitting…" : "Submit Request"}
      </button>
    </form>
  );
}

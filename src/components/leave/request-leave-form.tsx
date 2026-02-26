"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLeaveRequest, submitLeaveRequest } from "@/actions/leave.actions";
import type { LeaveType } from "@prisma/client";

interface Props {
  leaveTypes: LeaveType[];
}

export function RequestLeaveForm({ leaveTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(480); // 8h default
  const [note, setNote] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate || !leaveTypeId) return;

    setError(null);
    startTransition(async () => {
      // Create in DRAFT then immediately submit
      const createResult = await createLeaveRequest({
        leaveTypeId,
        startDate,
        endDate,
        durationMinutes,
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

      router.push("/leave");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
            min={startDate}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Duration (minutes)
        </label>
        <input
          type="number"
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
          min={1}
          required
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        <p className="mt-1 text-xs text-zinc-400">
          480 = 8 hours, 240 = 4 hours (half day)
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Reason or additional context…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestMissedPunch } from "@/actions/punch.actions";
import { PUNCH_TYPE_LABEL, type PunchTypeValue } from "@/lib/state-machines/labels";

const PUNCH_TYPES: PunchTypeValue[] = [
  "CLOCK_IN",
  "CLOCK_OUT",
  "MEAL_START",
  "MEAL_END",
  "BREAK_START",
  "BREAK_END",
];

export default function MissedPunchPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const punchType = fd.get("punchType") as PunchTypeValue;
    const punchTime = fd.get("punchTime") as string;
    const note = fd.get("note") as string;

    startTransition(async () => {
      const result = await requestMissedPunch({
        punchType,
        punchTime: new Date(punchTime).toISOString(),
        note,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push("/time/history");
    });
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
        Report Missed Punch
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Submit a missed punch for supervisor approval.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Punch Type
          </label>
          <select
            name="punchType"
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
          >
            {PUNCH_TYPES.map((pt) => (
              <option key={pt} value={pt}>
                {PUNCH_TYPE_LABEL[pt]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Date &amp; Time
          </label>
          <input
            type="datetime-local"
            name="punchTime"
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Note <span className="text-zinc-400">(required)</span>
          </label>
          <textarea
            name="note"
            required
            rows={3}
            placeholder="Explain why this punch was missed"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {isPending ? "Submitting…" : "Submit Request"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
